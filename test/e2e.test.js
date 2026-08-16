import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Full-stack test. Boots the real server against a throwaway database and walks
 * the paths a customer actually takes: free scan, signup, add site, scan, read
 * the report, get the fix plan, generate evidence, use the API.
 */

const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;
let server;
let dataDir;

const cookies = new Map();

function storeCookies(response) {
  for (const raw of response.headers.getSetCookie?.() || []) {
    const [pair] = raw.split(';');
    const index = pair.indexOf('=');
    const name = pair.slice(0, index).trim();
    const value = pair.slice(index + 1).trim();
    if (!value) cookies.delete(name);
    else cookies.set(name, value);
  }
}

function cookieHeader() {
  return [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function request(pathname, { method = 'GET', form = null, headers = {}, follow = false } = {}) {
  const response = await fetch(`${BASE}${pathname}`, {
    method,
    redirect: follow ? 'follow' : 'manual',
    headers: {
      ...(cookieHeader() ? { Cookie: cookieHeader() } : {}),
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...headers,
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  storeCookies(response);
  const body = await response.text();
  return { status: response.status, headers: response.headers, body, location: response.headers.get('location') };
}

function csrfFrom(html) {
  const match = html.match(/name="_csrf" value="([^"]+)"/);
  return match ? match[1] : null;
}

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), 'curbcut-e2e-'));
  server = spawn('node', ['--no-warnings', 'src/server.js'], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATABASE_PATH: path.join(dataDir, 'test.db'),
      SESSION_SECRET: 'test-secret-for-e2e-only',
      LOG_LEVEL: 'error',
      RENDER_MODE: 'static',
      APP_URL: BASE,
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  for (let i = 0; i < 60; i += 1) {
    try {
      const response = await fetch(`${BASE}/healthz`);
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('server did not start');
});

after(() => {
  server?.kill('SIGTERM');
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

describe('public site', () => {
  test('serves the landing page with the scan form', async () => {
    const res = await request('/');
    assert.equal(res.status, 200);
    assert.match(res.body, /<html lang="en">/);
    assert.match(res.body, /Skip to main content/);
    assert.match(res.body, /action="\/scan"/);
  });

  test('sets strict security headers', async () => {
    const res = await request('/');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    // Same-origin scripts only (the live scan view), never inline or third-party.
    const csp = res.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'/);
    assert.ok(!csp.includes('unsafe-eval'), 'must not allow eval');
    assert.ok(!/script-src[^;]*unsafe-inline/.test(csp), 'must not allow inline script');
  });

  test('serves the stylesheet and favicon', async () => {
    assert.equal((await request('/assets/app.css')).status, 200);
    assert.equal((await request('/assets/favicon.svg')).status, 200);
  });

  test('serves robots.txt and a sitemap', async () => {
    const robots = await request('/robots.txt');
    assert.match(robots.body, /Disallow: \/app\//);
    const sitemap = await request('/sitemap.xml');
    assert.match(sitemap.body, /<loc>.*\/pricing<\/loc>/);
  });

  test('returns 404 for unknown pages', async () => {
    const res = await request('/nope-does-not-exist');
    assert.equal(res.status, 404);
    assert.match(res.body, /Page not found/);
  });
});

describe('anonymous scan funnel', () => {
  let scanPath;

  test('runs a scan without an account', async () => {
    const res = await request('/scan', { method: 'POST', form: { url: `${BASE}/pricing` } });
    assert.equal(res.status, 303);
    assert.match(res.location, /^\/scan\//);
    scanPath = res.location;
  });

  test('shows the result with a score and a signup call to action', async () => {
    const res = await request(scanPath);
    assert.equal(res.status, 200);
    assert.match(res.body, /Accessibility score/);
    assert.match(res.body, /\/signup/);
  });

  test('captures an email against the scan', async () => {
    const res = await request(`${scanPath}/email`, {
      method: 'POST',
      form: { email: 'lead@example.com' },
    });
    assert.equal(res.status, 303);
  });

  test('rejects a private address', async () => {
    const res = await request('/scan', { method: 'POST', form: { url: 'http://169.254.169.254/' } });
    assert.equal(res.status, 400);
    assert.match(res.body, /Something went wrong|not publicly reachable|could not reach/i);
  });
});

describe('signup and application', () => {
  let siteId;
  let scanId;

  test('creates an account', async () => {
    const res = await request('/signup', {
      method: 'POST',
      form: {
        email: 'founder@example.com',
        password: 'a-long-enough-password',
        name: 'Test Founder',
        orgName: 'Test Co',
      },
    });
    assert.equal(res.status, 303);
    assert.ok(cookies.has('sid'), 'session cookie should be set');
  });

  test('rejects a weak password', async () => {
    const fresh = new Map(cookies);
    cookies.clear();
    const res = await request('/signup', {
      method: 'POST',
      form: { email: 'weak@example.com', password: 'short', orgName: 'X' },
    });
    assert.equal(res.status, 400);
    assert.match(res.body, /at least 10 characters/i);
    cookies.clear();
    for (const [k, v] of fresh) cookies.set(k, v);
  });

  test('shows the dashboard', async () => {
    const res = await request('/app');
    assert.equal(res.status, 200);
    assert.match(res.body, /Add a site|Sites/);
  });

  test('rejects a form post without a CSRF token', async () => {
    const res = await request('/app/sites/new', {
      method: 'POST',
      form: { baseUrl: BASE, name: 'No CSRF' },
    });
    assert.equal(res.status, 403);
  });

  test('creates a site and redirects straight to the live scan view', async () => {
    const form = await request('/app/sites/new');
    const csrf = csrfFrom(form.body);
    assert.ok(csrf, 'expected a CSRF token in the form');

    const res = await request('/app/sites/new', {
      method: 'POST',
      form: { _csrf: csrf, baseUrl: BASE, name: 'Self scan', maxPages: '10' },
    });
    assert.equal(res.status, 303);
    // The scan id must exist before any crawling starts, so the user can watch it.
    const match = res.location.match(/^\/app\/scans\/([0-9a-f-]+)\/progress$/);
    assert.ok(match, `expected a progress URL, got ${res.location}`);
    scanId = match[1];
  });

  test('the live progress page renders without JavaScript', async () => {
    const res = await request(`/app/scans/${scanId}/progress`);
    // It may already have finished and redirected to the report.
    if (res.status === 303) {
      assert.match(res.location, /\/app\/scans\//);
      return;
    }
    assert.equal(res.status, 200);
    assert.match(res.body, /Activity/);
    assert.match(res.body, /data-scan-id="/);
    assert.match(res.body, /progress-refresh|Scan finished/, 'expected a no-JS refresh fallback');
  });

  test('streams scan activity over server-sent events', async () => {
    const response = await fetch(`${BASE}/app/scans/${scanId}/stream`, {
      headers: { Cookie: cookieHeader() },
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    // The stream closes itself when the scan ends, so this terminates.
    for (let i = 0; i < 200; i += 1) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes('"type":"end"')) break;
    }
    await reader.cancel().catch(() => {});
    assert.match(buffer, /data: \{/, 'expected SSE data frames');
    assert.match(buffer, /"type":"(phase|page|fetch|end)"/, 'expected real scan events');
  });

  test('completes the scan and records a score', async () => {
    let body = '';
    for (let i = 0; i < 100; i += 1) {
      const res = await request(`/app/scans/${scanId}`);
      if (res.status === 200) {
        body = res.body;
        break;
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    assert.match(body, /Scan report/, 'scan should have completed');
    const siteMatch = body.match(/\/app\/sites\/([0-9a-f-]+)/);
    assert.ok(siteMatch, 'expected a link back to the site');
    siteId = siteMatch[1];
  });

  test('renders the scan report', async () => {
    const res = await request(`/app/scans/${scanId}`);
    assert.equal(res.status, 200);
    assert.match(res.body, /Scan report/);
    assert.match(res.body, /Issues/);
  });

  test('renders the pages list', async () => {
    const res = await request(`/app/scans/${scanId}/pages`);
    assert.equal(res.status, 200);
    assert.match(res.body, /Pages scanned/);
  });

  test('renders the fix plan on a trial plan', async () => {
    const res = await request(`/app/scans/${scanId}/fixes`);
    assert.equal(res.status, 200);
    assert.match(res.body, /Fix plan/);
  });

  test('serves a downloadable patch file', async () => {
    const res = await request(`/app/scans/${scanId}/patch`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /\.patch/);
  });

  test('generates each evidence document', async () => {
    const sitePage = await request(`/app/sites/${siteId}`);
    const csrf = csrfFrom(sitePage.body);

    for (const kind of ['statement', 'vpat', 'remediation']) {
      const res = await request(`/app/sites/${siteId}/evidence`, {
        method: 'POST',
        form: { _csrf: csrf, kind },
      });
      assert.equal(res.status, 303, `${kind} should generate`);
      const doc = await request(res.location);
      assert.equal(doc.status, 200);
      assert.match(doc.body, /Not Evaluated|Accessibility|Remediation/);
    }
  });

  test('the VPAT never claims blanket compliance', async () => {
    const sitePage = await request(`/app/sites/${siteId}`);
    const csrf = csrfFrom(sitePage.body);
    const res = await request(`/app/sites/${siteId}/evidence`, {
      method: 'POST', form: { _csrf: csrf, kind: 'vpat' },
    });
    const doc = await request(res.location);
    assert.match(doc.body, /Not Evaluated/, 'untestable criteria must be marked');
    assert.match(doc.body, /does not by itself establish legal compliance/i);
  });

  test('updates settings', async () => {
    const settings = await request('/app/settings');
    const csrf = csrfFrom(settings.body);
    const res = await request('/app/settings', {
      method: 'POST',
      form: { _csrf: csrf, name: 'Test Co', legalName: 'Test Co Ltd', contactEmail: 'a11y@test.co' },
    });
    assert.equal(res.status, 303);
    const updated = await request('/app/settings');
    assert.match(updated.body, /Test Co Ltd/);
  });

  test('blocks the admin area for non-staff', async () => {
    const res = await request('/admin');
    assert.equal(res.status, 404);
  });

  test('signs out', async () => {
    const settings = await request('/app/settings');
    const csrf = csrfFrom(settings.body);
    const res = await request('/logout', { method: 'POST', form: { _csrf: csrf } });
    assert.equal(res.status, 303);

    const after = await request('/app');
    assert.equal(after.status, 303);
    assert.match(after.location, /\/login/);
  });
});

describe('api', () => {
  let apiKey;

  test('rejects requests without a key', async () => {
    const res = await request('/api/v1/sites');
    assert.equal(res.status, 401);
  });

  test('issues a key and scans through the API', async () => {
    // Sign back in.
    const login = await request('/login');
    await request('/login', {
      method: 'POST',
      form: { _csrf: csrfFrom(login.body), email: 'founder@example.com', password: 'a-long-enough-password' },
    });

    const settings = await request('/app/settings');
    const res = await request('/app/settings/api-keys', {
      method: 'POST',
      form: { _csrf: csrfFrom(settings.body), name: 'CI' },
    });
    const match = res.body.match(/(cc_live_[A-Za-z0-9_-]+)/);
    assert.ok(match, 'expected the key to be shown once');
    apiKey = match[1];

    const scan = await fetch(`${BASE}/api/v1/scan`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `${BASE}/docs` }),
    });
    assert.equal(scan.status, 200);
    const payload = await scan.json();
    assert.equal(typeof payload.score, 'number');
    assert.ok(Array.isArray(payload.findings));
    assert.ok(payload.coverage);
  });

  test('lists sites through the API', async () => {
    const res = await fetch(`${BASE}/api/v1/sites`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    assert.equal(res.status, 200);
    const payload = await res.json();
    assert.ok(Array.isArray(payload.sites));
    assert.ok(payload.sites.length >= 1);
  });

  test('rejects a revoked key', async () => {
    const settings = await request('/app/settings');
    const keyId = settings.body.match(/api-keys\/([0-9a-f-]+)\/revoke/)?.[1];
    assert.ok(keyId);
    await request(`/app/settings/api-keys/${keyId}/revoke`, {
      method: 'POST',
      form: { _csrf: csrfFrom(settings.body) },
    });
    const res = await fetch(`${BASE}/api/v1/sites`, { headers: { Authorization: `Bearer ${apiKey}` } });
    assert.equal(res.status, 401);
  });
});
