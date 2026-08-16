import './helpers/test-env.js';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';

import { run, get, all } from '../src/db.js';
import { runScan, ledgerStats } from '../src/scan/runner.js';
import { generateDocument } from '../src/evidence/documents.js';
import { effectivePlanId } from '../src/billing.js';

/**
 * The finding ledger is the retention mechanism: it records when each distinct
 * issue was first seen and when it was confirmed fixed. These tests pin the
 * state transitions that record depends on.
 */

let server;
let port;
let currentHtml;
let siteId;
let orgId;

const PAGE_WITH_ISSUES = `<!DOCTYPE html>
<html>
<head><title>Shop</title></head>
<body>
  <main>
    <h1>Shop</h1>
    <img src="/a.jpg">
    <input type="text" name="q">
    <button></button>
  </main>
</body>
</html>`;

const PAGE_PARTLY_FIXED = `<!DOCTYPE html>
<html lang="en">
<head><title>Shop</title></head>
<body>
  <main>
    <h1>Shop</h1>
    <img src="/a.jpg" alt="A blue ceramic mug on a wooden table">
    <input type="text" name="q" aria-label="Search products">
    <button></button>
  </main>
</body>
</html>`;

before(async () => {
  currentHtml = PAGE_WITH_ISSUES;
  server = http.createServer((req, res) => {
    if (req.url === '/robots.txt') {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(currentHtml);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;

  const now = new Date().toISOString();
  orgId = randomUUID();
  siteId = randomUUID();
  run(
    `INSERT INTO orgs (id, name, slug, plan, contact_email, created_at) VALUES (?, ?, ?, 'growth', ?, ?)`,
    orgId, 'Ledger Test', `ledger-${orgId.slice(0, 8)}`, 'a11y@test.co', now
  );
  run(
    `INSERT INTO sites (id, org_id, name, base_url, max_pages, created_at) VALUES (?, ?, ?, ?, 1, ?)`,
    siteId, orgId, 'Ledger Site', `http://127.0.0.1:${port}`, now
  );
});

after(() => {
  server?.close();
});

describe('finding ledger', () => {
  let firstScanId;

  test('a first scan opens a ledger entry for every issue', async () => {
    const result = await runScan(siteId, { trigger: 'test' });
    firstScanId = result.scanId;

    const stats = ledgerStats(siteId);
    assert.ok(stats.open > 0, 'expected open entries');
    assert.equal(stats.resolved, 0);

    const states = all('SELECT * FROM finding_states WHERE site_id = ?', siteId);
    for (const state of states) {
      assert.equal(state.status, 'open');
      assert.ok(state.first_seen_at, 'first_seen_at must be recorded');
    }
  });

  test('detects the seeded violations', async () => {
    const rules = all(
      'SELECT DISTINCT rule_id FROM findings WHERE scan_id = ?', firstScanId
    ).map((r) => r.rule_id);
    for (const expected of ['html-has-lang', 'img-alt', 'input-label', 'button-name']) {
      assert.ok(rules.includes(expected), `expected ${expected}, got ${rules.join(', ')}`);
    }
  });

  test('fixed issues are marked resolved with a timestamp', async () => {
    currentHtml = PAGE_PARTLY_FIXED;
    await runScan(siteId, { trigger: 'test' });

    const resolved = all(
      `SELECT s.*, (SELECT rule_id FROM findings WHERE signature = s.signature AND site_id = s.site_id LIMIT 1) AS rule_id
       FROM finding_states s WHERE s.site_id = ? AND s.status = 'resolved'`,
      siteId
    );
    const resolvedRules = resolved.map((r) => r.rule_id);

    assert.ok(resolvedRules.includes('html-has-lang'), 'lang fix should be recorded as resolved');
    assert.ok(resolvedRules.includes('img-alt'), 'alt fix should be recorded as resolved');
    assert.ok(resolvedRules.includes('input-label'), 'label fix should be recorded as resolved');

    for (const entry of resolved) {
      assert.ok(entry.resolved_at, 'resolved_at must be set');
      assert.ok(entry.resolved_scan_id, 'the resolving scan must be recorded');
    }
  });

  test('issues that persist stay open with their original first-seen date', async () => {
    const stillOpen = all(
      `SELECT s.*, (SELECT rule_id FROM findings WHERE signature = s.signature AND site_id = s.site_id LIMIT 1) AS rule_id
       FROM finding_states s WHERE s.site_id = ? AND s.status = 'open'`,
      siteId
    );
    const openRules = stillOpen.map((r) => r.rule_id);
    assert.ok(openRules.includes('button-name'), 'the unfixed button should remain open');

    const button = stillOpen.find((r) => r.rule_id === 'button-name');
    assert.ok(new Date(button.last_seen_at) >= new Date(button.first_seen_at));
  });

  test('a regression reopens the original entry rather than creating a new one', async () => {
    const before = get(
      `SELECT COUNT(*) AS count FROM finding_states WHERE site_id = ?`, siteId
    ).count;

    currentHtml = PAGE_WITH_ISSUES; // Someone reverts the fix.
    await runScan(siteId, { trigger: 'test' });

    const after = get(
      `SELECT COUNT(*) AS count FROM finding_states WHERE site_id = ?`, siteId
    ).count;
    assert.equal(after, before, 'a regression must not create duplicate ledger rows');

    const reopened = all(
      `SELECT s.*, (SELECT rule_id FROM findings WHERE signature = s.signature AND site_id = s.site_id LIMIT 1) AS rule_id
       FROM finding_states s WHERE s.site_id = ? AND s.status = 'open'`,
      siteId
    ).map((r) => r.rule_id);

    assert.ok(reopened.includes('img-alt'), 'the reverted issue should be open again');

    const entry = get(
      `SELECT * FROM finding_states WHERE site_id = ? AND status = 'open'
       AND signature IN (SELECT signature FROM findings WHERE site_id = ? AND rule_id = 'img-alt')`,
      siteId, siteId
    );
    assert.equal(entry.resolved_at, null, 'reopening must clear the resolution date');
  });

  test('score improves when issues are fixed and falls when they regress', async () => {
    const scans = all(
      `SELECT score FROM scans WHERE site_id = ? AND status = 'complete' ORDER BY created_at`,
      siteId
    ).map((s) => s.score);
    assert.equal(scans.length, 3);
    assert.ok(scans[1] > scans[0], `score should rise after fixes (${scans[0]} → ${scans[1]})`);
    assert.ok(scans[2] < scans[1], `score should fall after a regression (${scans[1]} → ${scans[2]})`);
  });
});

describe('crawl coverage and false resolutions', () => {
  let server2;
  let siteId2;
  let linkToB = true;

  const withIssues = (heading) => `<!DOCTYPE html><html lang="en"><head><title>${heading}</title></head>
    <body><main><h1>${heading}</h1><img src="/x.jpg"><button></button></main></body></html>`;

  before(async () => {
    server2 = http.createServer((req, res) => {
      const path = req.url.split('?')[0];
      if (path === '/robots.txt') { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      if (path === '/') {
        res.end(`<!DOCTYPE html><html lang="en"><head><title>Home</title></head><body><main><h1>Home</h1>
          <a href="/a">Page A</a>${linkToB ? '<a href="/b">Page B</a>' : ''}</main></body></html>`);
        return;
      }
      res.end(withIssues(path === '/a' ? 'Page A' : 'Page B'));
    });
    await new Promise((resolve) => server2.listen(0, '127.0.0.1', resolve));

    const now = new Date().toISOString();
    siteId2 = randomUUID();
    run(
      `INSERT INTO sites (id, org_id, name, base_url, max_pages, created_at) VALUES (?, ?, ?, ?, 10, ?)`,
      siteId2, orgId, 'Coverage Site', `http://127.0.0.1:${server2.address().port}`, now
    );
  });

  after(() => server2?.close());

  test('a page that was not crawled does not have its issues marked resolved', async () => {
    // First scan reaches both /a and /b.
    await runScan(siteId2, { trigger: 'test' });
    const pagesFirst = all(
      `SELECT url FROM scan_pages WHERE scan_id = (SELECT id FROM scans WHERE site_id = ? ORDER BY created_at DESC LIMIT 1)`,
      siteId2
    ).map((r) => new URL(r.url).pathname);
    assert.ok(pagesFirst.includes('/a') && pagesFirst.includes('/b'), `expected both pages, got ${pagesFirst.join(',')}`);

    const openBefore = all(
      `SELECT COUNT(*) AS c FROM finding_states WHERE site_id = ? AND status = 'open'`, siteId2
    )[0].c;
    assert.ok(openBefore > 0);

    // Second scan can no longer discover /b. Nothing about it was verified.
    linkToB = false;
    await runScan(siteId2, { trigger: 'test' });

    const pagesSecond = all(
      `SELECT url FROM scan_pages WHERE scan_id = (SELECT id FROM scans WHERE site_id = ? ORDER BY created_at DESC LIMIT 1)`,
      siteId2
    ).map((r) => new URL(r.url).pathname);
    assert.ok(!pagesSecond.includes('/b'), 'page B should not have been crawled');

    // Findings on the uncrawled page must remain open. Marking them resolved
    // would put a fabricated fix date into a legal evidence document.
    const bStates = all(
      `SELECT s.status FROM finding_states s
       WHERE s.site_id = ? AND s.signature IN (
         SELECT f.signature FROM findings f
         JOIN scan_pages p ON p.id = f.page_id
         WHERE f.site_id = ? AND p.url LIKE '%/b'
       )`,
      siteId2, siteId2
    );
    assert.ok(bStates.length > 0, 'expected ledger entries for page B');
    for (const state of bStates) {
      assert.equal(state.status, 'open', 'an unvisited page must not be reported as fixed');
    }
  });
});

describe('trial entitlements', () => {
  const future = new Date(Date.now() + 5 * 86400_000).toISOString();
  const past = new Date(Date.now() - 86400_000).toISOString();

  test('an active trial keeps its plan', () => {
    assert.equal(effectivePlanId({ plan: 'growth', trial_ends_at: future }), 'growth');
  });

  test('an expired trial with no subscription falls back to free', () => {
    // Without this the 14-day trial would never actually end.
    assert.equal(effectivePlanId({ plan: 'growth', trial_ends_at: past }), 'free');
  });

  test('a paying customer keeps their plan after the trial date passes', () => {
    assert.equal(
      effectivePlanId({ plan: 'growth', trial_ends_at: past, stripe_subscription_id: 'sub_1', billing_status: 'active' }),
      'growth'
    );
  });

  test('a customer who never trialled keeps their plan', () => {
    assert.equal(effectivePlanId({ plan: 'starter', trial_ends_at: null }), 'starter');
  });
});

describe('evidence generation from ledger data', () => {
  test('produces an accessibility statement naming the organisation', () => {
    const doc = generateDocument('statement', { orgId, siteId });
    assert.match(doc.content, /Accessibility Statement for Ledger Site/);
    assert.match(doc.content, /a11y@test\.co/);
    assert.match(doc.content, /partially conformant/);
    assert.ok(doc.contentHash.length > 0);
    assert.equal(doc.version, 1);
  });

  test('produces a VPAT that marks untestable criteria honestly', () => {
    const doc = generateDocument('vpat', { orgId, siteId });
    assert.match(doc.content, /Accessibility Conformance Report/);
    assert.match(doc.content, /Not Evaluated/);
    assert.match(doc.content, /Does Not Support/);
    assert.ok(
      !/\bis fully compliant\b/i.test(doc.content),
      'the report must never claim full compliance'
    );
  });

  test('produces a remediation record showing resolved issues', () => {
    const doc = generateDocument('remediation', { orgId, siteId });
    assert.match(doc.content, /Remediation Record/);
    assert.match(doc.content, /Median time to resolution/);
    assert.match(doc.content, /Scan history/);
  });

  test('versions increment on regeneration', () => {
    const first = generateDocument('statement', { orgId, siteId });
    const second = generateDocument('statement', { orgId, siteId });
    assert.equal(second.version, first.version + 1);
  });
});
