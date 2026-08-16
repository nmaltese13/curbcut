import http from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import config from './config.js';
import log from './log.js';
import { get, all, run } from './db.js';
import {
  registerUser, authenticate, createSession, getSession, destroySession,
  csrfToken, verifyCsrf, AuthError, createApiKey, normalizeEmail,
  createPasswordReset, findPasswordReset, completePasswordReset, RESET_EXPIRY_MINUTES,
  createInvitation, findInvitation, acceptInvitation, listInvitations, revokeInvitation,
  INVITE_EXPIRY_DAYS,
} from './auth.js';
import { sendEmail, emailMode, recentEmails } from './email.js';
import { startScheduler, setSchedule, availableFrequencies, frequencyAllowed, FREQUENCIES } from './scheduler.js';
import { track, audit, funnelSummary, recentEvents, businessMetrics } from './analytics.js';
import { getPlan, checkLimit } from './plans.js';
import { startCheckout, billingPortalUrl, handleWebhook, BillingError, effectivePlanId } from './billing.js';
import { runScan, createScan, findingsForScan, groupByRule, scanHistory, ledgerStats, scanSinglePage } from './scan/runner.js';
import * as progress from './scan/progress.js';
import { closeBrowser } from './scan/render.js';
import { buildRemediationPlan } from './scan/fixer.js';
import { ScanError } from './scan/crawler.js';
import { generateDocument, listDocuments, getDocument } from './evidence/documents.js';
import { STYLES } from './web/styles.js';
import { SCAN_CLIENT } from './web/scan-client.js';
import { FAVICON, documentPage } from './web/layout.js';
import * as marketing from './web/pages/marketing.js';
import * as authPages from './web/pages/auth.js';
import * as appPages from './web/pages/app.js';
import * as progressPage from './web/pages/progress.js';
import * as adminPages from './web/pages/admin.js';
import * as servicePages from './web/pages/services.js';
import * as accountPages from './web/pages/account.js';
import { SERVICE_TIERS, createServiceRequest, listServiceRequests, updateServiceRequest, servicePipeline, serviceRequestsForOrg } from './services.js';
import { handleApiRequest } from './api.js';

/* ------------------------------------------------------------------ *
 * Tiny router
 * ------------------------------------------------------------------ */

const routes = [];

function route(method, pattern, handler) {
  const names = [];
  const regex = new RegExp(
    `^${pattern.replace(/:[a-zA-Z]+/g, (match) => {
      names.push(match.slice(1));
      return '([^/]+)';
    })}$`
  );
  routes.push({ method, regex, names, handler });
}

const GET = (pattern, handler) => route('GET', pattern, handler);
const POST = (pattern, handler) => route('POST', pattern, handler);

/* ------------------------------------------------------------------ *
 * Request helpers
 * ------------------------------------------------------------------ */

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    out[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return out;
}

async function readBody(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'Request body too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function parseForm(body) {
  const params = new URLSearchParams(body);
  const out = {};
  for (const [key, value] of params) out[key] = value;
  return out;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
    this.userFacing = true;
  }
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function hashIp(ip) {
  return createHash('sha256').update(`${ip}:${config.sessionSecret}`).digest('hex').slice(0, 32);
}

/* ------------------------------------------------------------------ *
 * Rate limiting
 * ------------------------------------------------------------------ */

const buckets = new Map();

function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const entry = buckets.get(key);
  if (!entry || now > entry.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return { allowed: true, remaining: max - 1 };
  }
  entry.count += 1;
  if (entry.count > max) {
    return { allowed: false, retryAfter: Math.ceil((entry.reset - now) / 1000) };
  }
  return { allowed: true, remaining: max - entry.count };
}

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of buckets) if (now > entry.reset) buckets.delete(key);
}, 60_000).unref();

/* ------------------------------------------------------------------ *
 * Response helpers
 * ------------------------------------------------------------------ */

function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  // Scripts are same-origin files only: no inline script, no third-party host.
  // The single script we ship (live scan progress) is served from /assets.
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; " +
      "connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  if (config.isProd) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

function sendHtml(res, body, status = 200) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

function redirect(res, location, status = 303) {
  res.writeHead(status, { Location: location });
  res.end();
}

function setSessionCookie(res, sessionId, expires) {
  const parts = [
    `sid=${sessionId}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expires.toUTCString()}`,
  ];
  if (config.isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

/* ------------------------------------------------------------------ *
 * Context
 * ------------------------------------------------------------------ */

function buildContext(req, url) {
  const cookies = parseCookies(req.headers.cookie);
  const auth = getSession(cookies.sid);
  const org = auth?.org || null;

  // Apply the effective plan for this request. The stored plan is left untouched
  // so the billing record and trial history survive; only entitlements change.
  if (org) org.plan = effectivePlanId(org);

  return {
    path: url.pathname,
    query: url.searchParams,
    user: auth?.user || null,
    org,
    membership: auth?.membership || null,
    memberships: auth?.memberships || [],
    sessionId: cookies.sid || null,
    csrf: cookies.sid ? csrfToken(cookies.sid) : '',
    isAdmin: Boolean(auth?.user?.is_admin),
    planFeatures: org ? getPlan(org.plan).features : getPlan('free').features,
    ip: clientIp(req),
  };
}

function requireAuth(ctx, res, url) {
  if (!ctx.user || !ctx.org) {
    redirect(res, `/login?next=${encodeURIComponent(url.pathname)}`);
    return false;
  }
  return true;
}

function requireCsrf(ctx, form) {
  if (!verifyCsrf(ctx.sessionId, form._csrf)) {
    throw new HttpError(403, 'Your session expired. Please reload the page and try again.');
  }
}

/* ------------------------------------------------------------------ *
 * Static assets
 * ------------------------------------------------------------------ */

GET('/assets/app.css', async (ctx, req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/css; charset=utf-8',
    'Cache-Control': config.isProd ? 'public, max-age=3600' : 'no-cache',
  });
  res.end(STYLES);
});

GET('/assets/scan.js', async (ctx, req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/javascript; charset=utf-8',
    'Cache-Control': config.isProd ? 'public, max-age=3600' : 'no-cache',
  });
  res.end(SCAN_CLIENT);
});

GET('/assets/favicon.svg', async (ctx, req, res) => {
  res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
  res.end(FAVICON);
});

GET('/healthz', async (ctx, req, res) => {
  sendJson(res, { status: 'ok', time: new Date().toISOString() });
});

GET('/robots.txt', async (ctx, req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  // /scan/ holds results about third-party sites and must stay out of indexes.
  res.end(
    `User-agent: *\nAllow: /\nDisallow: /app/\nDisallow: /admin\nDisallow: /scan/\n` +
    `Sitemap: ${config.appUrl}/sitemap.xml\n`
  );
});

GET('/sitemap.xml', async (ctx, req, res) => {
  const paths = [
    '/', '/pricing', '/services', '/how-it-works', '/docs', '/docs/api', '/accessibility',
    '/legal/privacy', '/legal/terms', '/contact',
    ...marketing.GUIDE_SLUGS.map((slug) => `/guides/${slug}`),
  ];
  const urls = paths
    .map((path) => `  <url><loc>${config.appUrl}${path}</loc></url>`)
    .join('\n');
  res.writeHead(200, { 'Content-Type': 'application/xml' });
  res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
});

/* ------------------------------------------------------------------ *
 * Marketing
 * ------------------------------------------------------------------ */

GET('/', async (ctx, req, res) => {
  if (ctx.user) return redirect(res, '/app');
  sendHtml(res, marketing.landingPage(ctx));
});

GET('/pricing', async (ctx, req, res) => sendHtml(res, marketing.pricingPage(ctx)));
GET('/how-it-works', async (ctx, req, res) => sendHtml(res, marketing.howItWorksPage(ctx)));
GET('/docs', async (ctx, req, res) => sendHtml(res, marketing.docsPage(ctx)));
GET('/docs/api', async (ctx, req, res) => sendHtml(res, marketing.apiDocsPage(ctx)));
GET('/accessibility', async (ctx, req, res) => sendHtml(res, marketing.ourAccessibilityPage(ctx)));
GET('/legal/privacy', async (ctx, req, res) => sendHtml(res, marketing.legalPage(ctx, 'privacy')));
GET('/legal/terms', async (ctx, req, res) => sendHtml(res, marketing.legalPage(ctx, 'terms')));
GET('/contact', async (ctx, req, res) => sendHtml(res, marketing.contactPage(ctx)));

GET('/services', async (ctx, req, res) => {
  sendHtml(res, servicePages.servicesPage(ctx, { kind: ctx.query.get('kind') }));
});

POST('/services', async (ctx, req, res, params, form) => {
  // Reachable while signed out, so CSRF is only enforced when a session exists.
  if (ctx.sessionId) requireCsrf(ctx, form);

  const limit = rateLimit(`service:${hashIp(ctx.ip)}`, 5, 3600_000);
  if (!limit.allowed) {
    return sendHtml(res, servicePages.servicesPage(ctx, {
      error: 'Too many requests from this address. Please email us directly.',
      values: form,
    }), 429);
  }

  if (!form.contactEmail || !SERVICE_TIERS[form.kind]) {
    return sendHtml(res, servicePages.servicesPage(ctx, {
      error: 'Choose a service and enter a valid email address.',
      values: form,
    }), 400);
  }

  createServiceRequest({
    kind: form.kind,
    orgId: ctx.org?.id || null,
    userId: ctx.user?.id || null,
    siteId: ctx.query.get('site') || form.siteId || null,
    scanId: ctx.query.get('scan') || form.scanId || null,
    contactName: form.contactName,
    contactEmail: form.contactEmail,
    company: form.company,
    siteUrl: form.siteUrl,
    notes: form.notes,
  });

  sendHtml(res, servicePages.servicesPage(ctx, { sent: true }));
});

POST('/contact', async (ctx, req, res, params, form) => {
  audit('contact_submitted', { userId: ctx.user?.id, meta: { email: form.email, company: form.company }, ip: ctx.ip });
  log.info('contact form', { email: form.email, company: form.company });
  sendHtml(res, marketing.contactPage(ctx, { sent: true }));
});

GET('/guides/:slug', async (ctx, req, res, params) => {
  const rendered = marketing.guidePage(ctx, params.slug);
  if (!rendered) return sendHtml(res, marketing.notFoundPage(ctx), 404);
  sendHtml(res, rendered);
});

/* ------------------------------------------------------------------ *
 * Public scan — the acquisition engine
 * ------------------------------------------------------------------ */

POST('/scan', async (ctx, req, res, params, form) => {
  const url = (form.url || '').trim();
  if (!url) return sendHtml(res, marketing.landingPage(ctx, { error: 'Enter a URL to scan.' }), 400);

  const limit = rateLimit(`scan:${hashIp(ctx.ip)}`, config.publicScan.perHourPerIp, 3600_000);
  if (!limit.allowed) {
    return sendHtml(
      res,
      marketing.landingPage(ctx, {
        url,
        error: `You've used all ${config.publicScan.perHourPerIp} free scans for this hour. Create an account for unlimited scanning.`,
      }),
      429
    );
  }

  track('public_scan_started', { props: { url } });

  try {
    const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    const result = await scanSinglePage(normalized);

    const scanId = randomUUID();
    run(
      `INSERT INTO public_scans (id, url, score, totals_json, findings_json, coverage_json, ip_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      scanId, result.url, result.score,
      // Keep the real element count alongside the totals so the stored result
      // can report what was actually examined rather than the finding count.
      JSON.stringify({ ...result.totals, elements: result.stats.elements }),
      JSON.stringify(result.findings.slice(0, 200)),
      JSON.stringify(result.coverage),
      hashIp(ctx.ip), new Date().toISOString()
    );

    track('public_scan_completed', { props: { url: result.url, score: result.score, findings: result.findings.length } });
    redirect(res, `/scan/${scanId}`);
  } catch (err) {
    track('public_scan_failed', { props: { url, error: err.code || 'unknown' } });
    const message = err.userFacing ? err.message : 'We could not reach that page. Check the address and try again.';
    if (!err.userFacing) log.error('public scan failed', { url, error: err.message });
    sendHtml(res, marketing.landingPage(ctx, { error: message, url }), 400);
  }
});

GET('/scan/:id', async (ctx, req, res, params) => {
  const record = get('SELECT * FROM public_scans WHERE id = ?', params.id);
  if (!record) return sendHtml(res, marketing.notFoundPage(ctx), 404);

  const totals = JSON.parse(record.totals_json || '{}');
  const result = {
    score: record.score,
    findings: JSON.parse(record.findings_json || '[]'),
    totals,
    coverage: JSON.parse(record.coverage_json || '{"complete":true}'),
    stats: { elements: totals.elements ?? null },
  };

  sendHtml(res, marketing.publicScanResultPage(ctx, {
    result,
    scanId: record.id,
    url: record.url,
    emailCaptured: Boolean(record.email) || ctx.query.get('sent') === '1',
  }));
});

POST('/scan/:id/email', async (ctx, req, res, params, form) => {
  const email = normalizeEmail(form.email);
  const record = get('SELECT * FROM public_scans WHERE id = ?', params.id);

  if (email && record) {
    run('UPDATE public_scans SET email = ? WHERE id = ?', email, params.id);
    track('public_scan_email_captured', { props: { scanId: params.id } });

    await sendEmail({
      to: email,
      template: 'public_scan_report',
      data: {
        url: record.url,
        score: record.score,
        totals: record.totals_json ? JSON.parse(record.totals_json) : {},
        reportUrl: `${config.appUrl}/scan/${params.id}`,
      },
    });
  }
  redirect(res, `/scan/${params.id}?sent=1`);
});

/* ------------------------------------------------------------------ *
 * Auth
 * ------------------------------------------------------------------ */

GET('/signup', async (ctx, req, res) => {
  if (ctx.user) return redirect(res, '/app');
  track('signup_started', { props: { plan: ctx.query.get('plan') } });
  sendHtml(res, authPages.signupPage(ctx, {
    plan: ctx.query.get('plan'),
    url: ctx.query.get('url'),
  }));
});

POST('/signup', async (ctx, req, res, params, form) => {
  try {
    const { userId, orgId } = await registerUser({
      email: form.email,
      password: form.password,
      name: form.name,
      orgName: form.orgName,
    });

    const session = createSession(userId, orgId, { ip: ctx.ip, userAgent: req.headers['user-agent'] });
    setSessionCookie(res, session.id, session.expires);

    track('signup_completed', { orgId, userId, props: { plan: form.plan || 'trial' } });
    audit('user_registered', { orgId, userId, ip: ctx.ip });

    // Carry a URL through from the free scan so the first site is pre-created.
    if (form.url) {
      try {
        const parsed = new URL(/^https?:\/\//i.test(form.url) ? form.url : `https://${form.url}`);
        const siteId = randomUUID();
        run(
          `INSERT INTO sites (id, org_id, name, base_url, max_pages, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
          siteId, orgId, parsed.hostname, parsed.origin, 25, new Date().toISOString()
        );
        return redirect(res, `/app/sites/${siteId}`);
      } catch {
        /* Fall through to the dashboard. */
      }
    }
    redirect(res, '/app');
  } catch (err) {
    if (err instanceof AuthError) {
      return sendHtml(res, authPages.signupPage(ctx, { error: err.message, values: form, plan: form.plan }), 400);
    }
    throw err;
  }
});

GET('/login', async (ctx, req, res) => {
  if (ctx.user) return redirect(res, '/app');
  sendHtml(res, authPages.loginPage(ctx, { next: ctx.query.get('next') }));
});

POST('/login', async (ctx, req, res, params, form) => {
  const limit = rateLimit(`login:${hashIp(ctx.ip)}`, 10, 900_000);
  if (!limit.allowed) {
    return sendHtml(res, authPages.loginPage(ctx, {
      error: 'Too many attempts. Try again in a few minutes.',
      email: form.email,
    }), 429);
  }

  const user = await authenticate(form.email, form.password);
  if (!user) {
    audit('login_failed', { meta: { email: normalizeEmail(form.email) }, ip: ctx.ip });
    return sendHtml(res, authPages.loginPage(ctx, {
      error: 'Those details did not match an account.',
      email: form.email,
      next: form.next,
    }), 401);
  }

  const membership = get('SELECT org_id FROM memberships WHERE user_id = ? LIMIT 1', user.id);
  const session = createSession(user.id, membership?.org_id || null, {
    ip: ctx.ip, userAgent: req.headers['user-agent'],
  });
  setSessionCookie(res, session.id, session.expires);

  track('login', { orgId: membership?.org_id, userId: user.id });
  audit('login', { orgId: membership?.org_id, userId: user.id, ip: ctx.ip });

  const next = form.next && form.next.startsWith('/') ? form.next : '/app';
  redirect(res, next);
});

GET('/forgot-password', async (ctx, req, res) => {
  if (ctx.user) return redirect(res, '/app');
  sendHtml(res, accountPages.forgotPasswordPage(ctx, {}));
});

POST('/forgot-password', async (ctx, req, res, params, form) => {
  const limit = rateLimit(`forgot:${hashIp(ctx.ip)}`, 5, 3600_000);
  if (!limit.allowed) {
    return sendHtml(res, accountPages.forgotPasswordPage(ctx, {
      error: 'Too many requests. Try again later.', email: form.email,
    }), 429);
  }

  const reset = createPasswordReset(form.email, { ip: ctx.ip });
  if (reset) {
    await sendEmail({
      to: normalizeEmail(form.email),
      template: 'password_reset',
      data: {
        resetUrl: `${config.appUrl}/reset-password?token=${encodeURIComponent(reset.token)}`,
        expiresMinutes: RESET_EXPIRY_MINUTES,
      },
    });
    audit('password_reset_requested', { userId: reset.userId, ip: ctx.ip });
  }

  // Identical response whether or not the account exists: anything else lets a
  // stranger enumerate which email addresses are registered.
  sendHtml(res, accountPages.forgotPasswordPage(ctx, { sent: true }));
});

GET('/reset-password', async (ctx, req, res) => {
  const token = ctx.query.get('token');
  const record = findPasswordReset(token);
  if (!record) return sendHtml(res, accountPages.resetPasswordPage(ctx, { invalid: true }), 400);
  sendHtml(res, accountPages.resetPasswordPage(ctx, { token }));
});

POST('/reset-password', async (ctx, req, res, params, form) => {
  try {
    const userId = await completePasswordReset(form.token, form.password);
    audit('password_reset_completed', { userId, ip: ctx.ip });

    const membership = get('SELECT org_id FROM memberships WHERE user_id = ? LIMIT 1', userId);
    const session = createSession(userId, membership?.org_id || null, {
      ip: ctx.ip, userAgent: req.headers['user-agent'],
    });
    setSessionCookie(res, session.id, session.expires);
    redirect(res, '/app');
  } catch (err) {
    if (err instanceof AuthError) {
      const stillValid = findPasswordReset(form.token);
      return sendHtml(res, accountPages.resetPasswordPage(ctx, {
        token: form.token, error: err.message, invalid: !stillValid,
      }), 400);
    }
    throw err;
  }
});

GET('/invite/accept', async (ctx, req, res) => {
  const token = ctx.query.get('token');
  const invite = findInvitation(token);
  if (!invite) return sendHtml(res, accountPages.acceptInvitePage(ctx, { invalid: true }), 400);
  sendHtml(res, accountPages.acceptInvitePage(ctx, { invite, token }));
});

POST('/invite/accept', async (ctx, req, res, params, form) => {
  try {
    const { userId, orgId } = await acceptInvitation(form.token, {
      name: form.name, password: form.password,
    });
    const session = createSession(userId, orgId, { ip: ctx.ip, userAgent: req.headers['user-agent'] });
    setSessionCookie(res, session.id, session.expires);
    track('invitation_accepted', { orgId, userId });
    audit('invitation_accepted', { orgId, userId, ip: ctx.ip });
    redirect(res, '/app');
  } catch (err) {
    if (err instanceof AuthError) {
      const invite = findInvitation(form.token);
      return sendHtml(res, accountPages.acceptInvitePage(ctx, {
        invite, token: form.token, error: err.message, invalid: !invite, values: form,
      }), 400);
    }
    throw err;
  }
});

POST('/logout', async (ctx, req, res) => {
  if (ctx.sessionId) {
    track('logout', { orgId: ctx.org?.id, userId: ctx.user?.id });
    destroySession(ctx.sessionId);
  }
  clearSessionCookie(res);
  redirect(res, '/');
});

/* ------------------------------------------------------------------ *
 * Application
 * ------------------------------------------------------------------ */

GET('/app', async (ctx, req, res, params, form, url) => {
  if (!requireAuth(ctx, res, url)) return;

  const sites = all(
    `SELECT s.*,
            (SELECT score FROM scans WHERE site_id = s.id AND status = 'complete' ORDER BY created_at DESC LIMIT 1) AS score,
            (SELECT finished_at FROM scans WHERE site_id = s.id AND status = 'complete' ORDER BY created_at DESC LIMIT 1) AS last_scan_at,
            (SELECT COUNT(*) FROM finding_states WHERE site_id = s.id AND status = 'open') AS open_issues
     FROM sites s WHERE s.org_id = ? AND s.archived_at IS NULL ORDER BY s.created_at DESC`,
    ctx.org.id
  );

  const notice = ctx.query.get('upgraded')
    ? `You're now on the ${getPlan(ctx.query.get('upgraded')).name} plan.`
    : null;

  sendHtml(res, appPages.dashboardPage(ctx, { sites, org: ctx.org, notice }));
});

GET('/app/sites', async (ctx, req, res, params, form, url) => redirect(res, '/app'));

GET('/app/sites/new', async (ctx, req, res, params, form, url) => {
  if (!requireAuth(ctx, res, url)) return;
  sendHtml(res, appPages.newSitePage(ctx, {}));
});

POST('/app/sites/new', async (ctx, req, res, params, form, url) => {
  if (!requireAuth(ctx, res, url)) return;
  requireCsrf(ctx, form);

  const siteCount = get('SELECT COUNT(*) AS count FROM sites WHERE org_id = ? AND archived_at IS NULL', ctx.org.id).count;
  const limit = checkLimit(ctx.org.plan, 'sites', siteCount);
  if (!limit.allowed) {
    return sendHtml(res, appPages.newSitePage(ctx, { values: form, limitMessage: limit.message }), 402);
  }

  let parsed;
  try {
    const raw = (form.baseUrl || '').trim();
    parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return sendHtml(res, appPages.newSitePage(ctx, { error: 'Enter a valid URL.', values: form }), 400);
  }

  const siteId = randomUUID();
  const maxPages = Math.min(
    Number(form.maxPages) || 25,
    getPlan(ctx.org.plan).limits.pagesPerScan
  );

  run(
    `INSERT INTO sites (id, org_id, name, base_url, max_pages, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    siteId, ctx.org.id, (form.name || '').trim() || parsed.hostname, parsed.origin, maxPages, new Date().toISOString()
  );

  track('site_created', { orgId: ctx.org.id, userId: ctx.user.id, props: { siteId } });
  audit('site_created', { orgId: ctx.org.id, userId: ctx.user.id, target: siteId, ip: ctx.ip });

  const scanId = startBackgroundScan(siteId, ctx.org.id);
  redirect(res, `/app/scans/${scanId}/progress`);
});

GET('/app/sites/:id', async (ctx, req, res, params, form, url) => {
  if (!requireAuth(ctx, res, url)) return;

  const site = get('SELECT * FROM sites WHERE id = ? AND org_id = ?', params.id, ctx.org.id);
  if (!site) return sendHtml(res, marketing.notFoundPage(ctx), 404);

  const latestScan = get(
    `SELECT * FROM scans WHERE site_id = ? AND status = 'complete' ORDER BY created_at DESC LIMIT 1`,
    site.id
  );
  const running = get(
    `SELECT id FROM scans WHERE site_id = ? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1`,
    site.id
  );
  const failed = get(
    `SELECT error FROM scans WHERE site_id = ? AND status = 'failed' ORDER BY created_at DESC LIMIT 1`,
    site.id
  );

  const rendered = appPages.sitePage(ctx, {
    site,
    frequencies: availableFrequencies(ctx.org.plan),
    allFrequencies: Object.values(FREQUENCIES),
    latestScan,
    history: scanHistory(site.id),
    ledger: ledgerStats(site.id),
    documents: listDocuments(site.id),
    notice: running || ctx.query.get('scanning')
      ? 'Scan in progress. This page will refresh automatically.'
      : (ctx.query.get('generated') ? 'Document generated.'
        : ctx.query.get('scheduled') ? 'Schedule updated.' : null),
    error: !running && failed && !latestScan ? failed.error : null,
  });

  // Poll while a scan is running, without shipping any JavaScript.
  if (running) {
    return sendHtml(res, rendered.replace('</head>', '<meta http-equiv="refresh" content="5"></head>'));
  }
  sendHtml(res, rendered);
});

POST('/app/sites/:id/scan', async (ctx, req, res, params, form, url) => {
  if (!requireAuth(ctx, res, url)) return;
  requireCsrf(ctx, form);

  const site = get('SELECT * FROM sites WHERE id = ? AND org_id = ?', params.id, ctx.org.id);
  if (!site) return sendHtml(res, marketing.notFoundPage(ctx), 404);

  const period = new Date().toISOString().slice(0, 7);
  const usage = get(
    `SELECT COUNT(*) AS count FROM scans WHERE org_id = ? AND created_at >= ?`,
    ctx.org.id, `${period}-01`
  ).count;

  const limit = checkLimit(ctx.org.plan, 'scansPerMonth', usage);
  if (!limit.allowed) {
    return sendHtml(res, appPages.sitePage(ctx, {
      site,
      latestScan: get(`SELECT * FROM scans WHERE site_id = ? AND status = 'complete' ORDER BY created_at DESC LIMIT 1`, site.id),
      history: scanHistory(site.id),
      ledger: ledgerStats(site.id),
      documents: listDocuments(site.id),
      error: limit.message,
    }), 402);
  }

  const scanId = startBackgroundScan(site.id, ctx.org.id);
  redirect(res, `/app/scans/${scanId}/progress`);
});

POST('/app/sites/:id/delete', async (ctx, req, res, params, form, url) => {
  if (!requireAuth(ctx, res, url)) return;
  requireCsrf(ctx, form);
  const site = get('SELECT * FROM sites WHERE id = ? AND org_id = ?', params.id, ctx.org.id);
  if (!site) return sendHtml(res, marketing.notFoundPage(ctx), 404);

  run('DELETE FROM sites WHERE id = ?', site.id);
  audit('site_deleted', { orgId: ctx.org.id, userId: ctx.user.id, target: site.id, ip: ctx.ip });
  redirect(res, '/app');
});

POST('/app/sites/:id/evidence', async (ctx, req, res, params, form, url) => {
  if (!requireAuth(ctx, res, url)) return;
  requireCsrf(ctx, form);

  if (!ctx.planFeatures.evidence) return redirect(res, '/app/settings/billing');

  try {
    const doc = generateDocument(form.kind, {
      orgId: ctx.org.id,
      siteId: params.id,
      userId: ctx.user.id,
    });
    track('evidence_generated', { orgId: ctx.org.id, userId: ctx.user.id, props: { kind: form.kind } });
    redirect(res, `/app/evidence/${doc.id}`);
  } catch (err) {
    log.warn('evidence generation failed', { error: err.message });
    redirect(res, `/app/sites/${params.id}`);
  }
});

GET('/app/scans/:id/progress', async (ctx, req, res, params, form, url) => {
  if (!requireAuth(ctx, res, url)) return;
  const scan = get('SELECT * FROM scans WHERE id = ? AND org_id = ?', params.id, ctx.org.id);
  if (!scan) return sendHtml(res, marketing.notFoundPage(ctx), 404);

  // A finished scan has nothing live to show.
  if (scan.status === 'complete') return redirect(res, `/app/scans/${scan.id}`);

  const site = get('SELECT * FROM sites WHERE id = ?', scan.site_id);
  sendHtml(res, progressPage.scanProgressPage(ctx, { site, scan, state: progress.snapshot(scan.id) }));
});

/** Server-Sent Events stream of live scan activity. */
GET('/app/scans/:id/stream', async (ctx, req, res, params, form, url) => {
  if (!ctx.user || !ctx.org) {
    res.writeHead(401).end();
    return;
  }
  const scan = get('SELECT id, status FROM scans WHERE id = ? AND org_id = ?', params.id, ctx.org.id);
  if (!scan) {
    res.writeHead(404).end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Proxies that buffer would defeat the point of streaming.
    'X-Accel-Buffering': 'no',
  });

  const send = (event) => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  // Replay what already happened so a reload or late connection is not blank.
  for (const event of progress.history(scan.id)) send(event);

  if (progress.hasEnded(scan.id) || scan.status === 'complete' || scan.status === 'failed') {
    send({ type: 'end', status: scan.status, reportUrl: `/app/scans/${scan.id}` });
    res.end();
    return;
  }

  const unsubscribe = progress.subscribe(scan.id, (event) => {
    send(event);
    if (event.type === 'end') {
      unsubscribe();
      clearInterval(heartbeat);
      res.end();
    }
  });

  // Comment frames keep intermediaries from timing the connection out.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 20_000);
  heartbeat.unref?.();

  req.on('close', () => {
    unsubscribe();
    clearInterval(heartbeat);
  });
});

GET('/app/scans/:id', async (ctx, req, res, params, form, url) => {
  if (!requireAuth(ctx, res, url)) return;
  const scan = get('SELECT * FROM scans WHERE id = ? AND org_id = ?', params.id, ctx.org.id);
  if (!scan) return sendHtml(res, marketing.notFoundPage(ctx), 404);

  // A scan still in flight belongs on the live view.
  if (scan.status === 'queued' || scan.status === 'running') {
    return redirect(res, `/app/scans/${scan.id}/progress`);
  }

  const site = get('SELECT * FROM sites WHERE id = ?', scan.site_id);
  const findings = findingsForScan(scan.id, { limit: 5000 });
  const pages = all('SELECT id, url FROM scan_pages WHERE scan_id = ?', scan.id);

  const tier = ctx.query.get('tier');
  const filter = ['definite', 'review', 'advisory'].includes(tier) ? tier : null;
  const definiteCount = findings.filter((f) => f.confidence === 'definite').length;

  sendHtml(res, appPages.scanReportPage(ctx, {
    site, scan, groups: groupByRule(findings), pages, filter,
    serviceCallout: servicePages.serviceCallout(ctx, {
      siteId: site.id, scanId: scan.id, definiteCount,
    }),
  }));
});

GET('/app/scans/:id/pages', async (ctx, req, res, params, form, url) => {
  if (!requireAuth(ctx, res, url)) return;
  const scan = get('SELECT * FROM scans WHERE id = ? AND org_id = ?', params.id, ctx.org.id);
  if (!scan) return sendHtml(res, marketing.notFoundPage(ctx), 404);

  const site = get('SELECT * FROM sites WHERE id = ?', scan.site_id);
  const pages = all(
    `SELECT p.*, (SELECT COUNT(*) FROM findings WHERE page_id = p.id) AS issue_count
     FROM scan_pages p WHERE p.scan_id = ? ORDER BY issue_count DESC`,
    scan.id
  );
  sendHtml(res, appPages.scanPagesPage(ctx, { site, scan, pages }));
});

GET('/app/scans/:id/fixes', async (ctx, req, res, params, form, url) => {
  if (!requireAuth(ctx, res, url)) return;
  const scan = get('SELECT * FROM scans WHERE id = ? AND org_id = ?', params.id, ctx.org.id);
  if (!scan) return sendHtml(res, marketing.notFoundPage(ctx), 404);

  const site = get('SELECT * FROM sites WHERE id = ?', scan.site_id);

  if (!ctx.planFeatures.fixes) {
    return sendHtml(res, appPages.fixPlanPage(ctx, { site, scan, plans: [], locked: true }), 402);
  }

  track('fix_plan_viewed', { orgId: ctx.org.id, userId: ctx.user.id, props: { scanId: scan.id } });
  sendHtml(res, appPages.fixPlanPage(ctx, { site, scan, plans: buildPlansForScan(scan.id) }));
});

GET('/app/scans/:id/patch', async (ctx, req, res, params, form, url) => {
  if (!requireAuth(ctx, res, url)) return;
  if (!ctx.planFeatures.fixes) return redirect(res, '/app/settings/billing');

  const scan = get('SELECT * FROM scans WHERE id = ? AND org_id = ?', params.id, ctx.org.id);
  if (!scan) return sendHtml(res, marketing.notFoundPage(ctx), 404);

  const pageUrl = ctx.query.get('page');
  const plans = buildPlansForScan(scan.id).filter((p) => !pageUrl || p.url === pageUrl);
  const patch = plans.map((p) => p.diff).filter(Boolean).join('\n');

  track('patch_downloaded', { orgId: ctx.org.id, userId: ctx.user.id, props: { scanId: scan.id } });

  res.writeHead(200, {
    'Content-Type': 'text/x-patch; charset=utf-8',
    'Content-Disposition': `attachment; filename="curbcut-${scan.id.slice(0, 8)}.patch"`,
  });
  res.end(patch || '# No mechanical fixes available for this selection.\n');
});

POST('/app/findings/:signature/status', async (ctx, req, res, params, form, url) => {
  if (!requireAuth(ctx, res, url)) return;
  requireCsrf(ctx, form);

  const site = get('SELECT id FROM sites WHERE id = ? AND org_id = ?', form.siteId, ctx.org.id);
  if (!site) return sendHtml(res, marketing.notFoundPage(ctx), 404);

  const allowed = ['open', 'in_progress', 'wontfix', 'false_positive'];
  if (!allowed.includes(form.status)) throw new HttpError(400, 'Invalid status.');

  run(
    `UPDATE finding_states SET status = ?, decided_by = ? WHERE site_id = ? AND signature = ?`,
    form.status, ctx.user.id, site.id, params.signature
  );

  track('finding_status_changed', { orgId: ctx.org.id, userId: ctx.user.id, props: { status: form.status } });
  audit('finding_status_changed', {
    orgId: ctx.org.id, userId: ctx.user.id, target: params.signature,
    meta: { status: form.status }, ip: ctx.ip,
  });

  redirect(res, `/app/scans/${form.scanId}`);
});

GET('/app/evidence/:id', async (ctx, req, res, params, form, url) => {
  if (!requireAuth(ctx, res, url)) return;
  const doc = getDocument(params.id, ctx.org.id);
  if (!doc) return sendHtml(res, marketing.notFoundPage(ctx), 404);
  const site = get('SELECT * FROM sites WHERE id = ?', doc.site_id);
  sendHtml(res, appPages.evidenceDocPage(ctx, { doc, site }));
});

GET('/app/evidence/:id/download', async (ctx, req, res, params, form, url) => {
  if (!requireAuth(ctx, res, url)) return;
  const doc = getDocument(params.id, ctx.org.id);
  if (!doc) return sendHtml(res, marketing.notFoundPage(ctx), 404);

  track('evidence_downloaded', { orgId: ctx.org.id, userId: ctx.user.id, props: { kind: doc.kind } });

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Disposition': `attachment; filename="${doc.kind}-v${doc.version}.html"`,
  });
  res.end(documentPage({ title: `${doc.kind} v${doc.version}`, body: doc.content }));
});

/* ---------- settings ---------- */

function settingsData(ctx) {
  return {
    org: ctx.org,
    members: all(
      `SELECT u.email, u.name, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ?`,
      ctx.org.id
    ),
    apiKeys: all(
      `SELECT * FROM api_keys WHERE org_id = ? AND revoked_at IS NULL ORDER BY created_at DESC`,
      ctx.org.id
    ),
    invitations: listInvitations(ctx.org.id),
  };
}

GET('/app/settings', async (ctx, req, res, params, form, url) => {
  if (!requireAuth(ctx, res, url)) return;
  sendHtml(res, appPages.settingsPage(ctx, { ...settingsData(ctx), notice: ctx.query.get('saved') ? 'Settings saved.' : null }));
});

POST('/app/settings', async (ctx, req, res, params, form, url) => {
  if (!requireAuth(ctx, res, url)) return;
  requireCsrf(ctx, form);

  run(
    `UPDATE orgs SET name = ?, legal_name = ?, contact_email = ? WHERE id = ?`,
    (form.name || '').trim() || ctx.org.name,
    (form.legalName || '').trim() || null,
    (form.contactEmail || '').trim() || null,
    ctx.org.id
  );
  audit('settings_updated', { orgId: ctx.org.id, userId: ctx.user.id, ip: ctx.ip });
  redirect(res, '/app/settings?saved=1');
});

POST('/app/settings/api-keys', async (ctx, req, res, params, form, url) => {
  if (!requireAuth(ctx, res, url)) return;
  requireCsrf(ctx, form);
  if (!ctx.planFeatures.api) return redirect(res, '/app/settings/billing');

  const key = createApiKey(ctx.org.id, form.name, ctx.user.id);
  track('api_key_created', { orgId: ctx.org.id, userId: ctx.user.id });
  audit('api_key_created', { orgId: ctx.org.id, userId: ctx.user.id, ip: ctx.ip });

  sendHtml(res, appPages.settingsPage(ctx, { ...settingsData(ctx), newKey: key }));
});

POST('/app/settings/api-keys/:id/revoke', async (ctx, req, res, params, form, url) => {
  if (!requireAuth(ctx, res, url)) return;
  requireCsrf(ctx, form);
  run(
    `UPDATE api_keys SET revoked_at = ? WHERE id = ? AND org_id = ?`,
    new Date().toISOString(), params.id, ctx.org.id
  );
  audit('api_key_revoked', { orgId: ctx.org.id, userId: ctx.user.id, target: params.id, ip: ctx.ip });
  redirect(res, '/app/settings');
});

POST('/app/settings/invite', async (ctx, req, res, params, form, url) => {
  if (!requireAuth(ctx, res, url)) return;
  requireCsrf(ctx, form);

  const seatsUsed = get('SELECT COUNT(*) AS count FROM memberships WHERE org_id = ?', ctx.org.id).count
    + listInvitations(ctx.org.id).length;
  const limit = checkLimit(ctx.org.plan, 'seats', seatsUsed);
  if (!limit.allowed) {
    return sendHtml(res, appPages.settingsPage(ctx, { ...settingsData(ctx), error: limit.message }), 402);
  }

  try {
    const invite = createInvitation({
      orgId: ctx.org.id,
      email: form.email,
      role: form.role,
      invitedBy: ctx.user.id,
    });
    await sendEmail({
      to: invite.email,
      template: 'invitation',
      orgId: ctx.org.id,
      data: {
        inviteUrl: `${config.appUrl}/invite/accept?token=${encodeURIComponent(invite.token)}`,
        orgName: ctx.org.name,
        invitedBy: ctx.user.name || ctx.user.email,
        expiresDays: INVITE_EXPIRY_DAYS,
      },
    });
    track('invitation_sent', { orgId: ctx.org.id, userId: ctx.user.id });
    audit('invitation_sent', { orgId: ctx.org.id, userId: ctx.user.id, target: invite.email, ip: ctx.ip });
    sendHtml(res, appPages.settingsPage(ctx, {
      ...settingsData(ctx), notice: `Invitation sent to ${invite.email}.`,
    }));
  } catch (err) {
    if (err instanceof AuthError) {
      return sendHtml(res, appPages.settingsPage(ctx, { ...settingsData(ctx), error: err.message }), 400);
    }
    throw err;
  }
});

POST('/app/settings/invite/revoke', async (ctx, req, res, params, form, url) => {
  if (!requireAuth(ctx, res, url)) return;
  requireCsrf(ctx, form);
  revokeInvitation(ctx.org.id, form.email);
  audit('invitation_revoked', { orgId: ctx.org.id, userId: ctx.user.id, target: form.email, ip: ctx.ip });
  redirect(res, '/app/settings');
});

POST('/app/sites/:id/schedule', async (ctx, req, res, params, form, url) => {
  if (!requireAuth(ctx, res, url)) return;
  requireCsrf(ctx, form);

  const site = get('SELECT * FROM sites WHERE id = ? AND org_id = ?', params.id, ctx.org.id);
  if (!site) return sendHtml(res, marketing.notFoundPage(ctx), 404);

  const requested = form.frequency || 'manual';
  if (!frequencyAllowed(ctx.org.plan, requested)) {
    return redirect(res, `/app/sites/${site.id}?upgrade=schedule`);
  }

  setSchedule(site.id, requested);
  run('UPDATE sites SET notify_emails = ? WHERE id = ?', form.notify === 'on' ? 1 : 0, site.id);
  audit('schedule_updated', {
    orgId: ctx.org.id, userId: ctx.user.id, target: site.id,
    meta: { frequency: requested }, ip: ctx.ip,
  });
  redirect(res, `/app/sites/${site.id}?scheduled=1`);
});

GET('/app/settings/billing', async (ctx, req, res, params, form, url) => {
  if (!requireAuth(ctx, res, url)) return;
  track('plan_viewed', { orgId: ctx.org.id, userId: ctx.user.id });

  let portalUrl = null;
  try {
    portalUrl = await billingPortalUrl(ctx.org, `${config.appUrl}/app/settings/billing`);
  } catch {
    /* Portal is optional. */
  }

  sendHtml(res, appPages.billingPage(ctx, {
    org: ctx.org,
    portalUrl,
    notice: ctx.query.get('upgraded') ? `You're now on the ${getPlan(ctx.query.get('upgraded')).name} plan.` : null,
    error: ctx.query.get('cancelled') ? 'Checkout was canceled.' : null,
  }));
});

POST('/app/settings/billing', async (ctx, req, res, params, form, url) => {
  if (!requireAuth(ctx, res, url)) return;
  requireCsrf(ctx, form);

  try {
    const result = await startCheckout({
      org: ctx.org,
      planId: form.plan,
      userId: ctx.user.id,
      returnUrl: `${config.appUrl}/app/settings/billing`,
    });
    redirect(res, result.url);
  } catch (err) {
    if (err instanceof BillingError) {
      return sendHtml(res, appPages.billingPage(ctx, { org: ctx.org, error: err.message }), 400);
    }
    throw err;
  }
});

POST('/webhooks/stripe', async (ctx, req, res, params, form, url, rawBody) => {
  try {
    const result = await handleWebhook(rawBody, req.headers['stripe-signature']);
    sendJson(res, result);
  } catch (err) {
    log.error('stripe webhook rejected', { error: err.message });
    sendJson(res, { error: err.message }, 400);
  }
});

/* ---------- admin ---------- */

/** Every admin route is gated the same way: staff only, and a 404 otherwise. */
function requireAdmin(ctx, res, url) {
  if (!requireAuth(ctx, res, url)) return false;
  if (!ctx.isAdmin) {
    sendHtml(res, marketing.notFoundPage(ctx), 404);
    return false;
  }
  return true;
}

/** Monthly recurring revenue from current plan assignments. */
function computeMrr() {
  const rows = all(`SELECT plan, COUNT(*) AS count FROM orgs WHERE plan != 'free' GROUP BY plan`);
  let total = 0;
  let payingCount = 0;
  for (const row of rows) {
    total += (getPlan(row.plan).price || 0) * row.count;
    payingCount += row.count;
  }
  return { total, payingCount, byPlan: rows };
}

GET('/admin', async (ctx, req, res, params, form, url) => {
  if (!requireAdmin(ctx, res, url)) return;

  sendHtml(res, adminPages.adminOverviewPage(ctx, {
    metrics: businessMetrics(),
    funnel: funnelSummary(30),
    mrr: computeMrr(),
    pipeline: servicePipeline(),
    recentScans: all(
      `SELECT s.id, s.score, s.status, s.created_at, si.name AS site_name, o.name AS org_name,
              (SELECT COUNT(*) FROM findings WHERE scan_id = s.id) AS findings_count
       FROM scans s
       LEFT JOIN sites si ON si.id = s.site_id
       LEFT JOIN orgs o ON o.id = s.org_id
       ORDER BY s.created_at DESC LIMIT 15`
    ),
    topIssues: all(
      `SELECT rule_id, COUNT(*) AS occurrences, COUNT(DISTINCT site_id) AS sites
       FROM findings GROUP BY rule_id ORDER BY occurrences DESC LIMIT 12`
    ),
  }));
});

GET('/admin/orgs', async (ctx, req, res, params, form, url) => {
  if (!requireAdmin(ctx, res, url)) return;
  sendHtml(res, adminPages.adminOrgsPage(ctx, {
    orgs: all(
      `SELECT o.*,
              (SELECT COUNT(*) FROM memberships WHERE org_id = o.id) AS user_count,
              (SELECT COUNT(*) FROM sites WHERE org_id = o.id AND archived_at IS NULL) AS site_count,
              (SELECT COUNT(*) FROM scans WHERE org_id = o.id) AS scan_count,
              (SELECT COUNT(*) FROM finding_states fs JOIN sites si ON si.id = fs.site_id
                WHERE si.org_id = o.id AND fs.status = 'open') AS open_issues,
              (SELECT MAX(created_at) FROM events WHERE org_id = o.id) AS last_activity
       FROM orgs o ORDER BY o.created_at DESC LIMIT 200`
    ),
  }));
});

GET('/admin/orgs/:id', async (ctx, req, res, params, form, url) => {
  if (!requireAdmin(ctx, res, url)) return;
  const org = get('SELECT * FROM orgs WHERE id = ?', params.id);
  if (!org) return sendHtml(res, marketing.notFoundPage(ctx), 404);

  sendHtml(res, adminPages.adminOrgDetailPage(ctx, {
    org,
    users: all(
      `SELECT u.email, u.name, u.last_login_at, m.role FROM memberships m
       JOIN users u ON u.id = m.user_id WHERE m.org_id = ?`, org.id
    ),
    sites: all(
      `SELECT s.*,
              (SELECT score FROM scans WHERE site_id = s.id AND status = 'complete' ORDER BY created_at DESC LIMIT 1) AS score,
              (SELECT COUNT(*) FROM finding_states WHERE site_id = s.id AND status = 'open') AS open_issues
       FROM sites s WHERE s.org_id = ?`, org.id
    ),
    scans: all(
      `SELECT id, score, status, pages_scanned, created_at FROM scans
       WHERE org_id = ? ORDER BY created_at DESC LIMIT 20`, org.id
    ),
    requests: serviceRequestsForOrg(org.id),
    events: all(
      `SELECT name, created_at FROM events WHERE org_id = ? ORDER BY created_at DESC LIMIT 40`, org.id
    ),
  }));
});

GET('/admin/services', async (ctx, req, res, params, form, url) => {
  if (!requireAdmin(ctx, res, url)) return;
  sendHtml(res, adminPages.adminServicesPage(ctx, {
    requests: listServiceRequests({ limit: 200 }),
    notice: ctx.query.get('saved') ? 'Request updated.' : null,
  }));
});

POST('/admin/services/:id', async (ctx, req, res, params, form, url) => {
  if (!requireAdmin(ctx, res, url)) return;
  requireCsrf(ctx, form);
  updateServiceRequest(params.id, {
    status: form.status,
    internalNotes: form.internalNotes || undefined,
    quotedAmount: form.quotedAmount || undefined,
  });
  audit('service_request_updated', { orgId: ctx.org.id, userId: ctx.user.id, target: params.id, ip: ctx.ip });
  redirect(res, '/admin/services?saved=1');
});

GET('/admin/leads', async (ctx, req, res, params, form, url) => {
  if (!requireAdmin(ctx, res, url)) return;
  sendHtml(res, adminPages.adminLeadsPage(ctx, {
    leads: all(
      `SELECT id, url, score, totals_json, email, created_at FROM public_scans
       ORDER BY (score IS NULL), score ASC, created_at DESC LIMIT 200`
    ),
  }));
});

GET('/admin/activity', async (ctx, req, res, params, form, url) => {
  if (!requireAdmin(ctx, res, url)) return;
  sendHtml(res, adminPages.adminActivityPage(ctx, {
    events: recentEvents(120),
    auditRows: all(`SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 120`),
  }));
});

GET('/admin/email', async (ctx, req, res, params, form, url) => {
  if (!requireAdmin(ctx, res, url)) return;
  sendHtml(res, adminPages.adminEmailPage(ctx, {
    emails: recentEmails(150),
    mode: emailMode(),
  }));
});

/* ------------------------------------------------------------------ *
 * Shared helpers used by routes
 * ------------------------------------------------------------------ */

/** Build per-page remediation plans from stored scan data. */
function buildPlansForScan(scanId) {
  const pages = all(
    `SELECT id, url, html FROM scan_pages WHERE scan_id = ? AND html IS NOT NULL`,
    scanId
  );
  const findings = findingsForScan(scanId, { limit: 5000 });

  const plans = [];
  for (const page of pages) {
    const pageFindings = findings
      .filter((f) => f.page_id === page.id)
      .map((f) => ({ ...f, offsets: f.offsets, fix: f.fix, title: f.title }));
    if (!pageFindings.length) continue;

    const plan = buildRemediationPlan(page.html, pageFindings, {
      filename: new URL(page.url).pathname.replace(/^\//, '') || 'index.html',
    });
    if (plan.counts.automatic === 0 && plan.counts.manual === 0) continue;
    plans.push({ ...plan, url: page.url });
  }

  return plans.sort((a, b) => b.counts.automatic - a.counts.automatic);
}

/**
 * Start a scan out of band and return its id immediately, so the caller can
 * redirect straight to the live progress view.
 */
function startBackgroundScan(siteId, orgId, trigger = 'manual') {
  const scanId = createScan(siteId, { trigger });
  setImmediate(() => {
    runScan(siteId, { trigger, scanId }).catch((err) => {
      log.warn('background scan failed', { siteId, orgId, scanId, error: err.message });
    });
  });
  return scanId;
}

/* ------------------------------------------------------------------ *
 * Server
 * ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const requestId = randomUUID().slice(0, 8);
  const started = Date.now();
  let url;

  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }

  securityHeaders(res);

  try {
    // The API authenticates by bearer token and returns JSON.
    if (url.pathname.startsWith('/api/')) {
      const body = req.method === 'POST' ? await readBody(req) : '';
      return await handleApiRequest(req, res, url, body, { rateLimit, clientIp: clientIp(req) });
    }

    const ctx = buildContext(req, url);

    let form = {};
    let rawBody = '';
    if (req.method === 'POST') {
      rawBody = await readBody(req);
      const contentType = req.headers['content-type'] || '';
      if (contentType.includes('application/json')) {
        try { form = JSON.parse(rawBody); } catch { form = {}; }
      } else {
        form = parseForm(rawBody);
      }
    }

    for (const candidate of routes) {
      if (candidate.method !== req.method) continue;
      const match = candidate.regex.exec(url.pathname);
      if (!match) continue;

      const params = {};
      candidate.names.forEach((name, index) => {
        params[name] = decodeURIComponent(match[index + 1]);
      });

      await candidate.handler(ctx, req, res, params, form, url, rawBody);

      log.debug('request', {
        requestId, method: req.method, path: url.pathname,
        status: res.statusCode, ms: Date.now() - started,
      });
      return;
    }

    sendHtml(res, marketing.notFoundPage(ctx), 404);
  } catch (err) {
    const status = err.status || (err instanceof ScanError ? 400 : 500);

    if (status >= 500) {
      log.error('request failed', {
        requestId, method: req.method, path: url.pathname,
        error: err.message, stack: err.stack?.split('\n').slice(0, 4).join(' | '),
      });
    } else {
      log.warn('request rejected', { requestId, path: url.pathname, error: err.message });
    }

    if (res.headersSent) {
      res.end();
      return;
    }

    const ctx = { user: null, path: url.pathname, csrf: '' };
    if (url.pathname.startsWith('/api/')) {
      sendJson(res, { error: err.userFacing ? err.message : 'Internal error', requestId }, status);
    } else if (err.userFacing) {
      sendHtml(res, marketing.errorPage(ctx, requestId), status);
    } else {
      sendHtml(res, marketing.errorPage(ctx, requestId), 500);
    }
  }
});

server.headersTimeout = 20_000;
server.requestTimeout = 120_000;

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  startScheduler();
  server.listen(config.port, config.host, () => {
    log.info('curbcut listening', {
      url: `http://${config.host}:${config.port}`,
      env: config.env,
      billing: config.stripe.enabled ? 'stripe' : 'local',
      email: emailMode(),
      ai: config.ai.enabled ? 'enabled' : 'disabled',
    });
  });

  const shutdown = (signal) => {
    log.info('shutting down', { signal });
    server.close(async () => {
      await closeBrowser();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export default server;
export { server, buildPlansForScan };
