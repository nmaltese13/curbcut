import { createHmac, timingSafeEqual } from 'node:crypto';
import { get, run } from './db.js';
import { PLANS, getPlan } from './plans.js';
import config from './config.js';
import { track, audit } from './analytics.js';
import log from './log.js';

/**
 * Billing sits behind a small interface so the product is fully usable before
 * Stripe is configured. With no API key the app runs in local mode and applies
 * plan changes directly, which keeps local development and demos working.
 */

const STRIPE_API = 'https://api.stripe.com/v1';

function formEncode(data, prefix = '') {
  const parts = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    const name = prefix ? `${prefix}[${key}]` : key;
    if (typeof value === 'object' && !Array.isArray(value)) {
      parts.push(formEncode(value, name));
    } else if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === 'object') parts.push(formEncode(item, `${name}[${index}]`));
        else parts.push(`${encodeURIComponent(`${name}[${index}]`)}=${encodeURIComponent(item)}`);
      });
    } else {
      parts.push(`${encodeURIComponent(name)}=${encodeURIComponent(value)}`);
    }
  }
  return parts.filter(Boolean).join('&');
}

async function stripeRequest(method, path, body) {
  if (!config.stripe.enabled) throw new BillingError('Stripe is not configured.');
  const response = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.stripe.secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body ? formEncode(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const payload = await response.json();
  if (!response.ok) {
    log.error('stripe error', { path, message: payload?.error?.message });
    throw new BillingError(payload?.error?.message || 'Payment provider error.');
  }
  return payload;
}

export class BillingError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BillingError';
    this.userFacing = true;
  }
}

export function billingMode() {
  return config.stripe.enabled ? 'stripe' : 'local';
}

function priceIdFor(planId) {
  const plan = getPlan(planId);
  if (!plan.stripePriceEnv) return null;
  return process.env[plan.stripePriceEnv] || null;
}

/**
 * Start a subscription. With Stripe configured this returns a Checkout URL;
 * otherwise the plan is applied immediately so the flow can be exercised end to
 * end in development.
 */
export async function startCheckout({ org, planId, userId, returnUrl }) {
  const plan = getPlan(planId);
  if (!plan || plan.id === 'free') throw new BillingError('Choose a paid plan.');

  track('checkout_started', { orgId: org.id, userId, props: { plan: planId, mode: billingMode() } });

  if (!config.stripe.enabled) {
    applyPlan(org.id, planId, { source: 'local' });
    audit('plan_changed_local', { orgId: org.id, userId, target: planId });
    return { mode: 'local', url: `${returnUrl}?upgraded=${planId}` };
  }

  const priceId = priceIdFor(planId);
  if (!priceId) {
    throw new BillingError(
      `No Stripe price is configured for the ${plan.name} plan. Set ${plan.stripePriceEnv} in the environment.`
    );
  }

  let customerId = org.stripe_customer_id;
  if (!customerId) {
    const customer = await stripeRequest('POST', '/customers', {
      email: org.contact_email,
      name: org.name,
      metadata: { org_id: org.id },
    });
    customerId = customer.id;
    run('UPDATE orgs SET stripe_customer_id = ? WHERE id = ?', customerId, org.id);
  }

  const session = await stripeRequest('POST', '/checkout/sessions', {
    mode: 'subscription',
    customer: customerId,
    success_url: `${returnUrl}?upgraded=${planId}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${returnUrl}?cancelled=1`,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    subscription_data: { metadata: { org_id: org.id, plan: planId } },
    metadata: { org_id: org.id, plan: planId },
  });

  return { mode: 'stripe', url: session.url };
}

export async function billingPortalUrl(org, returnUrl) {
  if (!config.stripe.enabled) return null;
  if (!org.stripe_customer_id) return null;
  const session = await stripeRequest('POST', '/billing_portal/sessions', {
    customer: org.stripe_customer_id,
    return_url: returnUrl,
  });
  return session.url;
}

export function applyPlan(orgId, planId, { subscriptionId = null, status = 'active', source = 'stripe' } = {}) {
  if (!PLANS[planId]) throw new BillingError(`Unknown plan: ${planId}`);
  run(
    `UPDATE orgs SET plan = ?, billing_status = ?, stripe_subscription_id = COALESCE(?, stripe_subscription_id),
     trial_ends_at = NULL WHERE id = ?`,
    planId, status, subscriptionId, orgId
  );
  track('plan_changed', { orgId, props: { plan: planId, source } });
  log.info('plan changed', { orgId, planId, source });
}

/**
 * Handle a Stripe webhook. Signature verification uses the raw request body,
 * so the server must pass the unparsed payload here.
 */
export async function handleWebhook(rawBody, signatureHeader) {
  if (!config.stripe.webhookSecret) throw new BillingError('Webhook secret not configured.');
  if (!verifyStripeSignature(rawBody, signatureHeader, config.stripe.webhookSecret)) {
    throw new BillingError('Invalid webhook signature.');
  }

  const event = JSON.parse(rawBody);
  const object = event.data?.object || {};

  switch (event.type) {
    case 'checkout.session.completed': {
      const orgId = object.metadata?.org_id;
      const planId = object.metadata?.plan;
      if (orgId && planId) applyPlan(orgId, planId, { subscriptionId: object.subscription });
      break;
    }
    case 'customer.subscription.updated': {
      const orgId = object.metadata?.org_id;
      const planId = object.metadata?.plan;
      if (orgId && planId && object.status === 'active') {
        applyPlan(orgId, planId, { subscriptionId: object.id });
      } else if (orgId && ['past_due', 'unpaid'].includes(object.status)) {
        run('UPDATE orgs SET billing_status = ? WHERE id = ?', object.status, orgId);
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const orgId = object.metadata?.org_id;
      if (orgId) {
        // Downgrade rather than delete: their evidence history must survive.
        run(`UPDATE orgs SET plan = 'free', billing_status = 'cancelled' WHERE id = ?`, orgId);
        track('plan_changed', { orgId, props: { plan: 'free', source: 'cancellation' } });
      }
      break;
    }
    default:
      log.debug('unhandled stripe event', { type: event.type });
  }

  return { received: true, type: event.type };
}

function verifyStripeSignature(payload, header, secret) {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((part) => part.split('=').map((s) => s.trim()))
  );
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  // Reject replays outside a five minute window.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (Number.isNaN(age) || age > 300) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The plan whose limits and features actually apply right now.
 *
 * Signup grants a Growth trial without taking a card, so an expired trial with no
 * subscription must fall back to Free. Without this the trial never ends.
 */
export function effectivePlanId(org) {
  if (!org) return 'free';
  if (org.stripe_subscription_id && org.billing_status === 'active') return org.plan;
  const trial = trialStatus(org);
  if (trial && trial.expired) return 'free';
  return org.plan;
}

/** Days remaining in trial, or null when not trialling. */
export function trialStatus(org) {
  if (!org?.trial_ends_at) return null;
  const ends = new Date(org.trial_ends_at);
  const days = Math.ceil((ends - Date.now()) / (24 * 60 * 60 * 1000));
  if (days < 0) return { expired: true, days: 0 };
  return { expired: false, days };
}

export default { startCheckout, applyPlan, handleWebhook, billingMode };
