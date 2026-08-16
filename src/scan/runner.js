import { randomUUID } from 'node:crypto';
import { get, all, run, transaction } from '../db.js';
import { crawl, safeFetch, ScanError } from './crawler.js';
import { renderPage, renderStatic, browserAvailable } from './render.js';
import { analyzePage, aggregate } from './engine.js';
import { RULES_BY_ID } from './rules.js';
import { track } from '../analytics.js';
import * as progress from './progress.js';
import { planLimit } from '../plans.js';
import log from '../log.js';

/**
 * Runs a scan and reconciles the results against the site's finding ledger.
 *
 * The ledger is the durable asset: it records when each distinct violation was
 * first seen, who triaged it, and when it was resolved. It is why a customer
 * cannot switch to another scanner without losing their remediation history,
 * and it is the raw material for the evidence documents.
 */

/**
 * Create the scan row up front so the caller has an id to redirect to before any
 * network work begins. The progress page needs to exist the moment the user
 * clicks, not after the crawl finishes.
 */
export function createScan(siteId, { trigger = 'manual' } = {}) {
  const site = get('SELECT * FROM sites WHERE id = ?', siteId);
  if (!site) throw new ScanError('Site not found.', 'not_found');

  const scanId = randomUUID();
  const now = new Date().toISOString();
  run(
    `INSERT INTO scans (id, site_id, org_id, status, trigger, created_at)
     VALUES (?, ?, ?, 'queued', ?, ?)`,
    scanId, siteId, site.org_id, trigger, now
  );
  return scanId;
}

export async function runScan(siteId, { trigger = 'manual', maxPages = null, scanId: existingScanId = null } = {}) {
  const site = get('SELECT * FROM sites WHERE id = ?', siteId);
  if (!site) throw new ScanError('Site not found.', 'not_found');

  const org = get('SELECT * FROM orgs WHERE id = ?', site.org_id);
  const pageBudget = Math.min(
    maxPages || site.max_pages || 25,
    planLimit(org.plan, 'pagesPerScan')
  );

  const scanId = existingScanId || createScan(siteId, { trigger });
  const now = new Date().toISOString();

  run(`UPDATE scans SET status = 'running', started_at = ? WHERE id = ?`, now, scanId);

  track('scan_started', { orgId: site.org_id, props: { siteId, trigger, pageBudget } });
  progress.emit(scanId, { type: 'phase', phase: 'starting', message: `Starting scan of ${site.base_url}` });
  progress.emit(scanId, { type: 'plan', pages: pageBudget });

  try {
    const pageResults = [];

    const useBrowser = await browserAvailable();
    progress.emit(scanId, {
      type: 'phase',
      phase: 'renderer',
      message: useBrowser
        ? 'Using a real browser: JavaScript will run and styles are measured directly'
        : 'Using static HTML analysis (install Playwright for full JavaScript coverage)',
    });

    await crawl(site.base_url, {
      maxPages: pageBudget,
      renderer: useBrowser ? (url) => renderPage(url) : null,
      onEvent: (event) => progress.emit(scanId, event),
      onPage: async (page) => {
        const pageId = randomUUID();

        if (page.error || !page.html) {
          run(
            `INSERT INTO scan_pages (id, scan_id, url, status_code, error) VALUES (?, ?, ?, ?, ?)`,
            pageId, scanId, page.url, page.status || null, page.error || 'No content returned'
          );
          return;
        }

        progress.emit(scanId, { type: 'analyze', url: page.url, bytes: page.bytes || page.html.length });

        const result = analyzePage(page.html, {
          url: page.url,
          css: page.css,
          computed: page.computed || null,
          layout: page.layout || null,
          renderMode: page.mode || 'static',
        });
        pageResults.push(result);

        progress.emit(scanId, {
          type: 'page',
          index: pageResults.length,
          url: page.url,
          title: result.stats.title,
          score: result.score,
          elements: result.stats.elements,
          findings: result.findings.length,
          definite: result.totals.definite,
          review: result.totals.review,
          advisory: result.totals.advisory,
          coverage: result.coverage.mode,
          durationMs: result.stats.durationMs,
          // The worst issues on this page, so the log shows real substance.
          top: result.findings
            .filter((f) => f.confidence === 'definite')
            .slice(0, 3)
            .map((f) => ({ ruleId: f.ruleId, impact: f.impact, message: f.message.slice(0, 120) })),
        });

        run(
          `INSERT INTO scan_pages (id, scan_id, url, status_code, title, bytes, render_mode, coverage_note, html)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          pageId, scanId, page.url, page.status, result.stats.title,
          result.stats.bytes, page.mode === 'browser' ? 'browser' : result.coverage.mode, result.coverage.note,
          // Retaining the source is what allows patch generation and re-verification.
          page.html.length < 800_000 ? page.html : null
        );

        const insert = `INSERT INTO findings
          (id, scan_id, page_id, site_id, rule_id, wcag, level, impact, confidence, message,
           selector, snippet, line, col, signature, fix_kind, fix_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

        for (const finding of result.findings) {
          run(
            insert,
            randomUUID(), scanId, pageId, siteId, finding.ruleId,
            (finding.wcag || []).join(','), finding.level, finding.impact, finding.confidence,
            finding.message, finding.selector, finding.snippet, finding.line, finding.col,
            finding.signature, finding.fix?.strategy || null,
            finding.fix || finding.data ? JSON.stringify({ fix: finding.fix, data: finding.data, offsets: finding.offsets }) : null,
            new Date().toISOString()
          );
        }
      },
    });

    if (!pageResults.length) {
      throw new ScanError('No readable HTML pages were found at that address.', 'no_pages');
    }

    progress.emit(scanId, { type: 'phase', phase: 'reconciling', message: 'Comparing against previous scans' });

    const summary = aggregate(pageResults);
    reconcileLedger(siteId, scanId);

    run(
      `UPDATE scans SET status = 'complete', finished_at = ?, pages_scanned = ?, score = ?,
       totals_json = ?, coverage_json = ? WHERE id = ?`,
      new Date().toISOString(), pageResults.length, summary.score,
      JSON.stringify(summary.totals), JSON.stringify(summary.coverage), scanId
    );

    track('scan_completed', {
      orgId: site.org_id,
      props: { siteId, scanId, pages: pageResults.length, score: summary.score, findings: summary.totals.total },
    });

    progress.end(scanId, {
      status: 'complete',
      score: summary.score,
      pages: pageResults.length,
      findings: summary.totals.total,
      reportUrl: `/app/scans/${scanId}`,
    });

    return { scanId, ...summary };
  } catch (err) {
    run(
      `UPDATE scans SET status = 'failed', finished_at = ?, error = ? WHERE id = ?`,
      new Date().toISOString(), err.message, scanId
    );
    track('scan_failed', { orgId: site.org_id, props: { siteId, error: err.code || 'unknown' } });
    log.error('scan failed', { siteId, scanId, error: err.message });
    progress.end(scanId, { status: 'failed', error: err.userFacing ? err.message : 'The scan could not be completed.' });
    throw err;
  }
}

/**
 * Compare this scan against the ledger: mark newly-seen issues, refresh
 * last-seen timestamps, and close anything that no longer appears.
 */
/** Compare URLs by path, so query strings and protocol changes do not split identity. */
function pathOf(url) {
  try {
    return new URL(url).pathname.replace(/\/$/, '') || '/';
  } catch {
    return url;
  }
}

export function reconcileLedger(siteId, scanId) {
  const now = new Date().toISOString();
  const current = all(
    'SELECT DISTINCT signature FROM findings WHERE scan_id = ?', scanId
  ).map((row) => row.signature);
  const currentSet = new Set(current);

  /**
   * Which pages this scan actually looked at.
   *
   * An issue can only be called resolved if we re-examined the page it lives on
   * and did not find it. Crawl coverage varies between scans — sitemaps change,
   * budgets differ, prioritization reorders the queue — so without this check a
   * page merely going unvisited would be recorded as a fix, complete with a
   * false resolution date, in a document sold as legal evidence.
   */
  const crawledPaths = new Set(
    all('SELECT url FROM scan_pages WHERE scan_id = ? AND error IS NULL', scanId).map((row) => pathOf(row.url))
  );

  const signaturePath = new Map();
  for (const row of all(
    `SELECT f.signature, MAX(p.url) AS url
     FROM findings f JOIN scan_pages p ON p.id = f.page_id
     WHERE f.site_id = ? GROUP BY f.signature`,
    siteId
  )) {
    signaturePath.set(row.signature, pathOf(row.url));
  }

  transaction(() => {
    for (const signature of current) {
      const existing = get(
        'SELECT signature, status FROM finding_states WHERE site_id = ? AND signature = ?',
        siteId, signature
      );
      if (existing) {
        // A previously resolved issue that reappears is a regression.
        if (existing.status === 'resolved') {
          run(
            `UPDATE finding_states SET status = 'open', last_seen_at = ?, resolved_at = NULL, resolved_scan_id = NULL
             WHERE site_id = ? AND signature = ?`,
            now, siteId, signature
          );
        } else {
          run(
            'UPDATE finding_states SET last_seen_at = ? WHERE site_id = ? AND signature = ?',
            now, siteId, signature
          );
        }
      } else {
        run(
          `INSERT INTO finding_states (site_id, signature, status, first_seen_at, last_seen_at)
           VALUES (?, ?, 'open', ?, ?)`,
          siteId, signature, now, now
        );
      }
    }

    // Close only what this scan actually re-checked and did not find again.
    const open = all(
      `SELECT signature FROM finding_states WHERE site_id = ? AND status IN ('open', 'in_progress')`,
      siteId
    );
    for (const row of open) {
      if (currentSet.has(row.signature)) continue;
      const path = signaturePath.get(row.signature);
      // Unknown origin, or a page this scan never visited: leave it open.
      // Absence of evidence is not evidence of a fix.
      if (path === undefined || !crawledPaths.has(path)) continue;
      run(
        `UPDATE finding_states SET status = 'resolved', resolved_at = ?, resolved_scan_id = ?
         WHERE site_id = ? AND signature = ?`,
        now, scanId, siteId, row.signature
      );
    }
  });
}

/** Findings for a scan, enriched with ledger state and rule metadata. */
export function findingsForScan(scanId, { status = null, ruleId = null, limit = 500 } = {}) {
  const rows = all(
    `SELECT f.*, p.url AS page_url, s.status AS ledger_status, s.first_seen_at, s.note
     FROM findings f
     JOIN scan_pages p ON p.id = f.page_id
     LEFT JOIN finding_states s ON s.site_id = f.site_id AND s.signature = f.signature
     WHERE f.scan_id = ?
     ORDER BY
       CASE f.confidence WHEN 'definite' THEN 0 WHEN 'review' THEN 1 ELSE 2 END,
       CASE f.impact WHEN 'critical' THEN 0 WHEN 'serious' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END,
       f.rule_id
     LIMIT ?`,
    scanId, limit
  );

  return rows
    .filter((row) => (!status || row.ledger_status === status) && (!ruleId || row.rule_id === ruleId))
    .map((row) => {
      const rule = RULES_BY_ID.get(row.rule_id);
      let extra = {};
      try {
        extra = row.fix_json ? JSON.parse(row.fix_json) : {};
      } catch { /* tolerate malformed rows */ }
      return {
        ...row,
        wcagList: row.wcag ? row.wcag.split(',') : [],
        why: rule?.why || null,
        title: rule?.title || row.rule_id,
        fix: extra.fix || null,
        data: extra.data || null,
        offsets: extra.offsets || null,
        ledger_status: row.ledger_status || 'open',
      };
    });
}

/** Group findings by rule for the report UI: teams fix by issue type, not by row. */
export function groupByRule(findings) {
  const groups = new Map();
  for (const finding of findings) {
    if (!groups.has(finding.rule_id)) {
      const rule = RULES_BY_ID.get(finding.rule_id);
      groups.set(finding.rule_id, {
        ruleId: finding.rule_id,
        title: rule?.title || finding.rule_id,
        why: rule?.why || '',
        wcag: finding.wcagList,
        level: finding.level,
        impact: finding.impact,
        confidence: finding.confidence,
        section508: rule?.section508 || [],
        items: [],
      });
    }
    groups.get(finding.rule_id).items.push(finding);
  }
  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  return [...groups.values()].sort(
    (a, b) => order[a.impact] - order[b.impact] || b.items.length - a.items.length
  );
}

/** Trend data for the dashboard: score and open-issue count over time. */
export function scanHistory(siteId, limit = 20) {
  return all(
    `SELECT id, score, pages_scanned, totals_json, created_at, finished_at, status
     FROM scans WHERE site_id = ? AND status = 'complete'
     ORDER BY created_at DESC LIMIT ?`,
    siteId, limit
  ).map((row) => ({
    ...row,
    totals: row.totals_json ? JSON.parse(row.totals_json) : { total: 0 },
  })).reverse();
}

export function ledgerStats(siteId) {
  const rows = all(
    `SELECT status, COUNT(*) AS count FROM finding_states WHERE site_id = ? GROUP BY status`,
    siteId
  );
  const stats = { open: 0, resolved: 0, wontfix: 0, in_progress: 0, false_positive: 0 };
  for (const row of rows) stats[row.status] = row.count;
  return stats;
}

/** Fetch a single page and analyze it without persisting anything. */
export async function scanSinglePage(url) {
  const rendered = await renderPage(url);
  return {
    ...analyzePage(rendered.html, {
      url: rendered.url,
      css: rendered.css,
      computed: rendered.computed,
      layout: rendered.layout,
      renderMode: rendered.mode,
    }),
    html: rendered.html,
  };
}

export default runScan;
