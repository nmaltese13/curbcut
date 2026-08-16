import { randomUUID } from 'node:crypto';
import { get, all, run } from './db.js';
import { resolveApiKey } from './auth.js';
import { getPlan, checkLimit } from './plans.js';
import { scanSinglePage, runScan, findingsForScan } from './scan/runner.js';
import { track } from './analytics.js';
import log from './log.js';

/**
 * REST API.
 *
 * The API exists to make Curbcut part of the deploy pipeline. Once a team's CI
 * fails on new violations, the product stops being a dashboard they remember to
 * visit and becomes infrastructure they cannot remove — which is the single
 * strongest retention mechanism available to us.
 */

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

function serializeFinding(finding) {
  return {
    ruleId: finding.ruleId || finding.rule_id,
    title: finding.title,
    impact: finding.impact,
    confidence: finding.confidence,
    wcag: finding.wcag || (finding.wcagList ?? []),
    level: finding.level,
    message: finding.message,
    selector: finding.selector,
    snippet: finding.snippet,
    line: finding.line,
    pageUrl: finding.page_url || finding.url || undefined,
  };
}

export async function handleApiRequest(req, res, url, body, { rateLimit, clientIp }) {
  const path = url.pathname;

  if (path === '/api/v1/health') {
    return json(res, { status: 'ok' });
  }

  // --- authentication ---
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const resolved = token ? resolveApiKey(token) : null;

  if (!resolved) {
    return json(res, { error: 'Missing or invalid API key.', docs: '/docs/api' }, 401);
  }

  const { org } = resolved;
  const plan = getPlan(org.plan);

  if (!plan.features.api) {
    return json(res, {
      error: `API access requires the Growth plan or above. Your organization is on ${plan.name}.`,
      upgrade: '/app/settings/billing',
    }, 402);
  }

  // --- rate limiting ---
  const limit = rateLimit(`api:${org.id}`, 60, 60_000);
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfter));
    return json(res, { error: 'Rate limit exceeded. 60 requests per minute.' }, 429);
  }

  let payload = {};
  if (body) {
    try {
      payload = JSON.parse(body);
    } catch {
      return json(res, { error: 'Request body must be valid JSON.' }, 400);
    }
  }

  try {
    /* ---- POST /api/v1/scan : scan one URL, no persistence ---- */
    if (path === '/api/v1/scan' && req.method === 'POST') {
      if (!payload.url) return json(res, { error: 'A "url" field is required.' }, 400);

      const period = new Date().toISOString().slice(0, 7);
      const usage = get(
        `SELECT COUNT(*) AS count FROM scans WHERE org_id = ? AND created_at >= ?`,
        org.id, `${period}-01`
      ).count;
      const quota = checkLimit(org.plan, 'scansPerMonth', usage);
      if (!quota.allowed) return json(res, { error: quota.message }, 429);

      track('api_scan_requested', { orgId: org.id, props: { url: payload.url } });

      const result = await scanSinglePage(payload.url);

      return json(res, {
        url: result.url,
        score: result.score,
        totals: {
          total: result.totals.total,
          critical: result.totals.critical,
          serious: result.totals.serious,
          moderate: result.totals.moderate,
          minor: result.totals.minor,
          definite: result.totals.definite,
          review: result.totals.review,
        },
        coverage: {
          complete: result.coverage.complete,
          mode: result.coverage.mode,
          note: result.coverage.note,
        },
        findings: result.findings.map(serializeFinding),
      });
    }

    /* ---- GET /api/v1/sites ---- */
    if (path === '/api/v1/sites' && req.method === 'GET') {
      const sites = all(
        `SELECT s.id, s.name, s.base_url, s.created_at,
                (SELECT score FROM scans WHERE site_id = s.id AND status = 'complete' ORDER BY created_at DESC LIMIT 1) AS score,
                (SELECT COUNT(*) FROM finding_states WHERE site_id = s.id AND status = 'open') AS open_issues
         FROM sites s WHERE s.org_id = ? AND s.archived_at IS NULL`,
        org.id
      );
      return json(res, { sites });
    }

    /* ---- POST /api/v1/sites/:id/scans ---- */
    const scanMatch = path.match(/^\/api\/v1\/sites\/([^/]+)\/scans$/);
    if (scanMatch && req.method === 'POST') {
      const site = get('SELECT * FROM sites WHERE id = ? AND org_id = ?', scanMatch[1], org.id);
      if (!site) return json(res, { error: 'Site not found.' }, 404);

      const result = await runScan(site.id, { trigger: 'api' });
      return json(res, {
        scanId: result.scanId,
        score: result.score,
        pages: result.pages,
        totals: result.totals,
        coverage: result.coverage,
        reportUrl: `/app/scans/${result.scanId}`,
      });
    }

    /* ---- GET /api/v1/scans/:id ---- */
    const reportMatch = path.match(/^\/api\/v1\/scans\/([^/]+)$/);
    if (reportMatch && req.method === 'GET') {
      const scan = get('SELECT * FROM scans WHERE id = ? AND org_id = ?', reportMatch[1], org.id);
      if (!scan) return json(res, { error: 'Scan not found.' }, 404);

      const findings = findingsForScan(scan.id, { limit: 1000 });
      return json(res, {
        id: scan.id,
        status: scan.status,
        score: scan.score,
        pagesScanned: scan.pages_scanned,
        totals: scan.totals_json ? JSON.parse(scan.totals_json) : null,
        coverage: scan.coverage_json ? JSON.parse(scan.coverage_json) : null,
        findings: findings.map(serializeFinding),
      });
    }

    return json(res, { error: 'Unknown endpoint.', docs: '/docs/api' }, 404);
  } catch (err) {
    if (err.userFacing) return json(res, { error: err.message }, 400);
    log.error('api error', { path, error: err.message });
    return json(res, { error: 'Internal error.' }, 500);
  }
}

export default handleApiRequest;
