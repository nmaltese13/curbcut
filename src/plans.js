/**
 * Plan definitions.
 *
 * Pricing rationale: the alternatives a buyer is choosing between are a $490-$3,990/yr
 * overlay that does not fix anything, a $25-$400/mo scanner that hands them a backlog,
 * or a $5,000-$50,000 manual audit that is stale on the next deploy. We sit above the
 * scanners because we deliver remediation and evidence, and far below the audit because
 * the work is automated. The free tier exists to acquire, not to serve.
 */

export const PLANS = {
  free: {
    id: 'free',
    name: 'Free',
    price: 0,
    priceLabel: '$0',
    cadence: 'forever',
    tagline: 'See exactly where you stand.',
    limits: {
      sites: 1,
      pagesPerScan: 25,
      scansPerMonth: 4,
      seats: 1,
    },
    features: {
      fixes: false,
      evidence: false,
      api: false,
      ciIntegration: false,
      history: false,
    },
    highlights: [
      'Scan 1 site, up to 25 pages',
      'Full WCAG 2.1 AA violation report',
      'Severity and WCAG criterion mapping',
      'Plain-English explanation of every issue',
    ],
    missing: ['Code-level fixes', 'Accessibility statement', 'VPAT / ACR draft', 'Scan history'],
  },

  starter: {
    id: 'starter',
    name: 'Starter',
    price: 79,
    priceLabel: '$79',
    cadence: 'per month',
    tagline: 'For a single site that needs to get compliant and stay there.',
    stripePriceEnv: 'STRIPE_PRICE_STARTER',
    limits: {
      sites: 1,
      pagesPerScan: 250,
      scansPerMonth: 30,
      seats: 3,
    },
    features: {
      fixes: true,
      evidence: true,
      api: false,
      ciIntegration: false,
      history: true,
    },
    highlights: [
      'Everything in Free, plus:',
      'Up to 250 pages per scan',
      'Ready-to-merge code patches',
      'Published accessibility statement',
      'Scan history and remediation ledger',
    ],
  },

  growth: {
    id: 'growth',
    name: 'Growth',
    price: 249,
    priceLabel: '$249',
    cadence: 'per month',
    popular: true,
    tagline: 'For teams shipping continuously who need proof for buyers.',
    stripePriceEnv: 'STRIPE_PRICE_GROWTH',
    limits: {
      sites: 5,
      pagesPerScan: 2500,
      scansPerMonth: 200,
      seats: 10,
    },
    features: {
      fixes: true,
      evidence: true,
      api: true,
      ciIntegration: true,
      history: true,
    },
    highlights: [
      'Everything in Starter, plus:',
      'Up to 5 sites and 2,500 pages per scan',
      'VPAT 2.5 / ACR draft export',
      'REST API and CI integration',
      'Block pull requests that add new violations',
    ],
  },

  scale: {
    id: 'scale',
    name: 'Scale',
    price: 749,
    priceLabel: '$749',
    cadence: 'per month',
    tagline: 'For agencies and multi-property organizations.',
    stripePriceEnv: 'STRIPE_PRICE_SCALE',
    limits: {
      sites: 25,
      pagesPerScan: 25000,
      scansPerMonth: 1000,
      seats: 50,
    },
    features: {
      fixes: true,
      evidence: true,
      api: true,
      ciIntegration: true,
      history: true,
    },
    highlights: [
      'Everything in Growth, plus:',
      'Up to 25 sites and 25,000 pages per scan',
      'Per-site evidence packs for client reporting',
      'Priority scan queue',
      'Onboarding call and shared Slack channel',
    ],
  },
};

export const PLAN_ORDER = ['free', 'starter', 'growth', 'scale'];

export function getPlan(id) {
  return PLANS[id] || PLANS.free;
}

export function planAllows(planId, feature) {
  return Boolean(getPlan(planId).features[feature]);
}

export function planLimit(planId, limit) {
  return getPlan(planId).limits[limit] ?? 0;
}

/**
 * Enforce a limit and return a message explaining the upgrade path. Returning a
 * suggestion rather than a bare failure is what turns a limit into revenue.
 */
export function checkLimit(planId, limit, currentValue) {
  const max = planLimit(planId, limit);
  if (currentValue < max) return { allowed: true };

  const nextPlan = PLAN_ORDER.slice(PLAN_ORDER.indexOf(planId) + 1).find(
    (id) => planLimit(id, limit) > max
  );

  const labels = {
    sites: 'sites',
    pagesPerScan: 'pages per scan',
    scansPerMonth: 'scans this month',
    seats: 'team members',
  };

  return {
    allowed: false,
    max,
    message: nextPlan
      ? `Your ${getPlan(planId).name} plan includes ${max} ${labels[limit]}. Upgrade to ${getPlan(nextPlan).name} for ${planLimit(nextPlan, limit)}.`
      : `You have reached the maximum of ${max} ${labels[limit]}. Contact us to raise this limit.`,
    upgradeTo: nextPlan || null,
  };
}

export default PLANS;
