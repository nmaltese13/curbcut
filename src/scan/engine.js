import { createHash } from 'node:crypto';
import { parseDocument, cssPath, snippet, location, textContent, tagName, attr, isElement } from '../lib/html.js';
import { parseStylesheet } from '../lib/css.js';
import { RULES } from './rules.js';
import log from '../log.js';

const IMPACT_WEIGHT = { critical: 10, serious: 5, moderate: 2, minor: 1 };

/**
 * Score weight by confidence tier.
 *
 * `definite` — machine-verifiable failure, counts fully.
 * `review`   — strong signal needing a human decision, counts at 40%.
 * `advisory` — a real best-practice or robustness issue that is not a WCAG
 *              failure. Worth surfacing, must never move the score, and must
 *              never appear in a conformance document.
 *
 * The lookup below is deliberately explicit rather than defaulting to 1: an
 * unknown tier scoring like a confirmed failure is a silent corruption of the
 * only number customers look at.
 */
const CONFIDENCE_WEIGHT = { definite: 1, review: 0.4, advisory: 0 };
export const CONFIDENCE_TIERS = ['definite', 'review', 'advisory'];

/**
 * Detect pages whose content is rendered client-side. Reporting "0 violations"
 * for an empty JavaScript shell would be actively misleading, so we surface the
 * limitation instead. This is the failure mode the FTC penalized accessiBe for.
 */
export function detectCoverage(doc, html) {
  const body = doc.byTag.get('body')?.[0];
  const text = body ? textContent(body) : '';
  const scripts = (doc.byTag.get('script') || []).length;
  const elementCount = doc.elements.length;

  const rootShell = doc.elements.some((el) => {
    const id = (attr(el, 'id') || '').toLowerCase();
    return ['root', 'app', '__next', '__nuxt', 'gatsby-focus-wrapper'].includes(id);
  });

  const sparse = text.length < 200 && elementCount < 60;

  if (sparse && (rootShell || scripts > 0)) {
    return {
      mode: 'client-rendered',
      complete: false,
      note: 'This page appears to render its content with JavaScript. Curbcut analyzed the HTML the server returned, which contained little content, so these results cover only a fraction of the page. Connect the browser renderer for full coverage.',
    };
  }

  if (rootShell && text.length < 800) {
    return {
      mode: 'partial',
      complete: false,
      note: 'This page uses a client-side framework and may render additional content after load. Results cover the server-rendered HTML only.',
    };
  }

  return { mode: 'static', complete: true, note: null };
}

/**
 * Stable identity for a finding across scans, so the ledger can track it.
 *
 * `key` disambiguates rules that report several distinct problems against the
 * same element — for example multiple CSS rules that each suppress the focus
 * outline, which all anchor to <body>. Without it those would share one identity
 * and collapse into a single ledger entry.
 */
export function signatureFor({ ruleId, url, selector, key = '' }) {
  let path = url || '';
  try {
    path = new URL(url).pathname;
  } catch {
    /* Relative or missing URL: fall back to the raw value. */
  }
  return createHash('sha1').update(`${ruleId}|${path}|${selector}|${key}`).digest('hex').slice(0, 20);
}

export function scoreFrom(findings) {
  let penalty = 0;
  for (const finding of findings) {
    const impact = IMPACT_WEIGHT[finding.impact] ?? 1;
    const weight = CONFIDENCE_WEIGHT[finding.confidence];
    if (weight === undefined) {
      log.warn('unknown confidence tier, scoring as confirmed', { confidence: finding.confidence, ruleId: finding.ruleId });
    }
    penalty += impact * (weight ?? 1);
  }
  // Saturating curve: the difference between 40 and 400 violations matters less
  // than the difference between 0 and 10.
  const score = Math.round(100 / (1 + penalty / 20));
  return Math.max(0, Math.min(100, score));
}

export function summarize(findings) {
  const totals = {
    total: findings.length,
    critical: 0, serious: 0, moderate: 0, minor: 0,
    definite: 0, review: 0, advisory: 0,
    byRule: {},
    byWcag: {},
  };
  for (const finding of findings) {
    totals[finding.impact] = (totals[finding.impact] || 0) + 1;
    totals[finding.confidence] = (totals[finding.confidence] || 0) + 1;
    totals.byRule[finding.ruleId] = (totals.byRule[finding.ruleId] || 0) + 1;
    for (const criterion of finding.wcag || []) {
      totals.byWcag[criterion] = (totals.byWcag[criterion] || 0) + 1;
    }
  }
  return totals;
}

/**
 * Run every rule against one page.
 * @param {string} html Raw HTML source.
 * @param {object} options
 * @param {string} options.url Absolute URL of the page.
 * @param {string} options.css Concatenated CSS from <style> blocks and linked stylesheets.
 */
export function analyzePage(html, { url = null, css = '', computed = null, layout = null, renderMode = null } = {}) {
  const started = Date.now();
  const doc = parseDocument(html, { url });

  // Inline <style> content is always available; linked stylesheets are supplied
  // by the crawler when it could fetch them.
  let inlineCss = '';
  for (const style of doc.byTag.get('style') || []) {
    for (const child of style.childNodes || []) {
      if (child.nodeName === '#text') inlineCss += `\n${child.value}`;
    }
  }
  const rawCss = `${css || ''}\n${inlineCss}`;
  const sheet = parseStylesheet(rawCss);

  // `computed` holds real browser-measured styles keyed by CSS selector. When
  // present, rules prefer it over anything inferred from the stylesheet.
  const ctx = { url, sheet, rawCss, css, computed, layout, renderMode };
  const findings = [];

  for (const rule of RULES) {
    let results = [];
    try {
      results = rule.run(doc, ctx) || [];
    } catch (err) {
      // One broken rule must never fail an entire scan.
      log.error('rule failed', { ruleId: rule.id, url, error: err.message });
      continue;
    }

    for (const result of results) {
      const node = result.node;
      const selector = node ? cssPath(node) : 'html';
      const loc = node ? location(node) : null;
      findings.push({
        ruleId: rule.id,
        title: rule.title,
        why: rule.why,
        wcag: rule.wcag,
        level: rule.level,
        section508: rule.section508 || [],
        impact: result.impact || rule.impact,
        confidence: result.confidence,
        message: result.message,
        selector,
        snippet: node ? snippet(node, html) : null,
        line: loc ? loc.line : null,
        col: loc ? loc.col : null,
        offsets: loc ? { start: loc.startOffset, end: loc.endOffset, elementEnd: loc.elementEndOffset } : null,
        tag: node && isElement(node) ? tagName(node) : null,
        data: result.data || null,
        fix: result.fix || null,
        signature: signatureFor({ ruleId: rule.id, url, selector, key: result.key || '' }),
      });
    }
  }

  const coverage = renderMode === 'browser'
    ? {
        mode: 'browser',
        complete: true,
        note: null,
      }
    : detectCoverage(doc, html);
  const cssCoverage = {
    unsupportedColorRules: sheet.unsupported,
    complete: sheet.unsupported === 0,
    note: sheet.unsupported > 0
      ? `${sheet.unsupported} CSS rule(s) using selectors Curbcut does not evaluate (pseudo-classes, attribute selectors) may affect text contrast. Those elements were skipped rather than guessed.`
      : null,
  };

  return {
    url,
    findings,
    totals: summarize(findings),
    score: scoreFrom(findings),
    coverage,
    cssCoverage,
    renderMode: renderMode || 'static',
    stats: {
      elements: doc.elements.length,
      measured: computed ? Object.keys(computed).length : 0,
      bytes: html.length,
      durationMs: Date.now() - started,
      title: textContent(doc.byTag.get('title')?.[0] || { childNodes: [] }, { includeHidden: true }) || null,
    },
  };
}

/** Aggregate several page results into a single site-level result. */
export function aggregate(pageResults) {
  const findings = pageResults.flatMap((page) => page.findings);
  const incomplete = pageResults.filter((page) => !page.coverage.complete);
  return {
    score: scoreFrom(findings),
    totals: summarize(findings),
    pages: pageResults.length,
    coverage: {
      complete: incomplete.length === 0,
      incompletePages: incomplete.length,
      note: incomplete.length
        ? `${incomplete.length} of ${pageResults.length} page(s) render content with JavaScript; results for those pages cover server-rendered HTML only.`
        : null,
    },
  };
}

export default analyzePage;
