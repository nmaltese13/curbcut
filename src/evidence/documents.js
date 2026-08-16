import { randomUUID, createHash } from 'node:crypto';
import { get, all, run } from '../db.js';
import { evaluateCriteria, coverageStats, CRITERIA } from './wcag.js';
import { findingsForScan, ledgerStats } from '../scan/runner.js';
import { escapeHtml } from '../web/html.js';

/**
 * Evidence generation.
 *
 * This is the layer buyers actually pay to keep. A scan report is a commodity;
 * a dated, versioned, defensible record of what was tested, what was found, what
 * was fixed and when, is what gets attached to a procurement response or handed
 * to counsel after a demand letter. Every document is content-hashed and
 * versioned so it can be cited later.
 */

const DISCLAIMER =
  'This document reports the results of automated testing supplemented by the remediation record held in Curbcut. ' +
  'Automated tools can reliably detect only a subset of WCAG success criteria. ' +
  'This document does not by itself establish legal compliance, and criteria marked "Not Evaluated" or ' +
  '"Needs Manual Review" require assessment by a qualified reviewer, including testing with assistive technology.';

function formatDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/* ------------------------------------------------------------------ *
 * Accessibility statement (required by the European Accessibility Act)
 * ------------------------------------------------------------------ */

export function buildAccessibilityStatement({ org, site, scan, findings }) {
  const definite = findings.filter((f) => f.confidence === 'definite');
  const byRule = new Map();
  for (const finding of definite) {
    byRule.set(finding.rule_id, (byRule.get(finding.rule_id) || 0) + 1);
  }

  const outstanding = [...byRule.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([ruleId, count]) => {
      const example = definite.find((f) => f.rule_id === ruleId);
      return { title: example?.title || ruleId, count, wcag: example?.wcagList?.join(', ') || '' };
    });

  const conformanceStatus = definite.length === 0
    ? 'partially conformant'
    : 'partially conformant';

  const orgName = org.legal_name || org.name;
  const contact = org.contact_email || 'accessibility@example.com';

  const body = `
<h1>Accessibility Statement for ${escapeHtml(site.name)}</h1>

<p>${escapeHtml(orgName)} is committed to ensuring digital accessibility for people with disabilities. We are
continually improving the user experience for everyone and applying the relevant accessibility standards.</p>

<h2>Conformance status</h2>
<p>The <a href="https://www.w3.org/WAI/standards-guidelines/wcag/">Web Content Accessibility Guidelines (WCAG)</a>
define requirements for designers and developers to improve accessibility for people with disabilities. It defines
three levels of conformance: Level A, Level AA, and Level AAA.</p>
<p><strong>${escapeHtml(site.name)} is ${conformanceStatus} with WCAG 2.1 level AA.</strong> "Partially conformant"
means that some parts of the content do not fully conform to the accessibility standard.</p>

<h2>Assessment approach</h2>
<p>${escapeHtml(orgName)} assessed the accessibility of ${escapeHtml(site.name)} by the following approaches:</p>
<ul>
  <li>Automated evaluation of ${scan.pages_scanned} page${scan.pages_scanned === 1 ? '' : 's'} against WCAG 2.1 Level A and AA,
      most recently on ${formatDate(scan.finished_at || scan.created_at)}.</li>
  <li>Ongoing monitoring, with each detected issue tracked from first detection through to resolution.</li>
</ul>

<h2>Known limitations</h2>
${outstanding.length === 0
  ? '<p>Automated testing did not detect confirmed failures at the most recent assessment. Issues that require manual review are being assessed on an ongoing basis.</p>'
  : `<p>Despite our best efforts, the following limitations are known. We are actively working to resolve them.</p>
<ul>
${outstanding.map((item) => `  <li><strong>${escapeHtml(item.title)}</strong> — ${item.count} occurrence${item.count === 1 ? '' : 's'} detected${item.wcag ? ` (WCAG ${escapeHtml(item.wcag)})` : ''}.</li>`).join('\n')}
</ul>`}

<h2>Feedback</h2>
<p>We welcome your feedback on the accessibility of ${escapeHtml(site.name)}. Please let us know if you encounter
accessibility barriers:</p>
<ul>
  <li>Email: <a href="mailto:${escapeHtml(contact)}">${escapeHtml(contact)}</a></li>
</ul>
<p>We aim to respond to feedback within 5 business days.</p>

<h2>Assessment date</h2>
<p>This statement was generated on ${formatDate(new Date().toISOString())} and reflects the automated assessment
completed on ${formatDate(scan.finished_at || scan.created_at)}.</p>

<hr>
<p><small>${escapeHtml(DISCLAIMER)}</small></p>
`.trim();

  return body;
}

/* ------------------------------------------------------------------ *
 * VPAT 2.5 / Accessibility Conformance Report
 * ------------------------------------------------------------------ */

export function buildVpat({ org, site, scan, findings }) {
  const evaluated = evaluateCriteria(findings);
  const coverage = coverageStats();
  const orgName = escapeHtml(org.legal_name || org.name);

  const levelA = evaluated.filter((c) => c.level === 'A');
  const levelAA = evaluated.filter((c) => c.level === 'AA');

  const summary = {
    supports: evaluated.filter((c) => c.conformance === 'Supports').length,
    partial: evaluated.filter((c) => c.conformance === 'Partially Supports').length,
    doesNot: evaluated.filter((c) => c.conformance === 'Does Not Support').length,
    manual: evaluated.filter((c) => c.conformance === 'Needs Manual Review').length,
    notEvaluated: evaluated.filter((c) => c.conformance === 'Not Evaluated').length,
  };

  const renderRows = (rows) => rows.map((criterion) => `
    <tr>
      <td><a href="https://www.w3.org/WAI/WCAG21/Understanding/">${criterion.id}</a> ${escapeHtml(criterion.name)} (Level ${criterion.level})</td>
      <td class="conformance conformance-${criterion.conformance.toLowerCase().replace(/\s+/g, '-')}">${criterion.conformance}</td>
      <td>${escapeHtml(criterion.remarks)}</td>
    </tr>`).join('');

  return `
<h1>Accessibility Conformance Report</h1>
<p class="subtitle">Based on VPAT&reg; Version 2.5 &mdash; WCAG 2.1 Edition</p>

<table class="meta-table">
  <tr><th scope="row">Name of product</th><td>${escapeHtml(site.name)}</td></tr>
  <tr><th scope="row">Product URL</th><td>${escapeHtml(site.base_url)}</td></tr>
  <tr><th scope="row">Report date</th><td>${formatDate(new Date().toISOString())}</td></tr>
  <tr><th scope="row">Vendor</th><td>${orgName}</td></tr>
  <tr><th scope="row">Contact</th><td>${escapeHtml(org.contact_email || '')}</td></tr>
  <tr><th scope="row">Evaluation methods</th><td>Automated evaluation of ${scan.pages_scanned} page(s) using Curbcut, combined with the tracked remediation record for this property.</td></tr>
</table>

<h2>Applicable standards</h2>
<ul>
  <li>Web Content Accessibility Guidelines 2.1, Level A and Level AA</li>
  <li>Revised Section 508 standards (36 CFR Part 1194, Appendix A), which incorporate WCAG 2.0 Level AA by reference</li>
  <li>EN 301 549 (the harmonized European standard referenced by the European Accessibility Act)</li>
</ul>

<h2>Summary</h2>
<table class="meta-table">
  <tr><th scope="row">Supports</th><td>${summary.supports} criteria</td></tr>
  <tr><th scope="row">Partially Supports</th><td>${summary.partial} criteria</td></tr>
  <tr><th scope="row">Does Not Support</th><td>${summary.doesNot} criteria</td></tr>
  <tr><th scope="row">Needs Manual Review</th><td>${summary.manual} criteria</td></tr>
  <tr><th scope="row">Not Evaluated</th><td>${summary.notEvaluated} criteria</td></tr>
</table>

<div class="callout">
  <p><strong>Scope of automated evaluation.</strong> Of the ${coverage.total} Level A and AA success criteria in
  WCAG 2.1, ${coverage.full} can be fully determined by automated testing and ${coverage.partial} can be partially
  determined. The remaining ${coverage.none} require human judgment and are reported as "Not Evaluated" in this
  document. A complete Accessibility Conformance Report suitable for a formal procurement response requires those
  criteria to be assessed by a qualified reviewer.</p>
</div>

<h2>Table 1: Success Criteria, Level A</h2>
<table class="criteria-table">
  <thead><tr><th scope="col">Criterion</th><th scope="col">Conformance Level</th><th scope="col">Remarks and Explanations</th></tr></thead>
  <tbody>${renderRows(levelA)}</tbody>
</table>

<h2>Table 2: Success Criteria, Level AA</h2>
<table class="criteria-table">
  <thead><tr><th scope="col">Criterion</th><th scope="col">Conformance Level</th><th scope="col">Remarks and Explanations</th></tr></thead>
  <tbody>${renderRows(levelAA)}</tbody>
</table>

<hr>
<p><small>${escapeHtml(DISCLAIMER)}</small></p>
<p><small>VPAT&reg; is a registered trademark of the Information Technology Industry Council (ITI).</small></p>
`.trim();
}

/* ------------------------------------------------------------------ *
 * Remediation record — the audit trail
 * ------------------------------------------------------------------ */

export function buildRemediationRecord({ org, site }) {
  const scans = all(
    `SELECT id, score, pages_scanned, totals_json, finished_at, trigger
     FROM scans WHERE site_id = ? AND status = 'complete' ORDER BY created_at`,
    site.id
  );

  const resolved = all(
    `SELECT s.signature, s.first_seen_at, s.resolved_at, s.status, s.note,
            (SELECT rule_id FROM findings WHERE signature = s.signature AND site_id = s.site_id LIMIT 1) AS rule_id,
            (SELECT message FROM findings WHERE signature = s.signature AND site_id = s.site_id LIMIT 1) AS message
     FROM finding_states s
     WHERE s.site_id = ? AND s.status = 'resolved'
     ORDER BY s.resolved_at DESC LIMIT 200`,
    site.id
  );

  const stats = ledgerStats(site.id);

  const daysToFix = resolved
    .filter((r) => r.resolved_at && r.first_seen_at)
    .map((r) => (new Date(r.resolved_at) - new Date(r.first_seen_at)) / (1000 * 60 * 60 * 24));
  const medianDays = daysToFix.length
    ? Math.round(daysToFix.sort((a, b) => a - b)[Math.floor(daysToFix.length / 2)] * 10) / 10
    : null;

  return `
<h1>Remediation Record for ${escapeHtml(site.name)}</h1>
<p class="subtitle">${escapeHtml(org.legal_name || org.name)} &mdash; generated ${formatDate(new Date().toISOString())}</p>

<div class="callout">
  <p>This record documents accessibility issues detected on ${escapeHtml(site.base_url)}, the date each was first
  detected, and the date it was confirmed resolved by a subsequent automated scan. It is intended as evidence of an
  ongoing, good-faith remediation programme.</p>
</div>

<h2>Current status</h2>
<table class="meta-table">
  <tr><th scope="row">Open issues</th><td>${stats.open}</td></tr>
  <tr><th scope="row">Resolved issues</th><td>${stats.resolved}</td></tr>
  <tr><th scope="row">Accepted / won't fix</th><td>${stats.wontfix}</td></tr>
  <tr><th scope="row">Total scans performed</th><td>${scans.length}</td></tr>
  <tr><th scope="row">Median time to resolution</th><td>${medianDays === null ? 'Not yet available' : `${medianDays} days`}</td></tr>
</table>

<h2>Scan history</h2>
<table class="criteria-table">
  <thead><tr><th scope="col">Date</th><th scope="col">Pages</th><th scope="col">Score</th><th scope="col">Issues found</th><th scope="col">Trigger</th></tr></thead>
  <tbody>
${scans.map((scan) => {
  const totals = scan.totals_json ? JSON.parse(scan.totals_json) : { total: 0 };
  return `    <tr><td>${formatDate(scan.finished_at)}</td><td>${scan.pages_scanned}</td><td>${scan.score}</td><td>${totals.total}</td><td>${escapeHtml(scan.trigger)}</td></tr>`;
}).join('\n')}
  </tbody>
</table>

<h2>Resolved issues</h2>
${resolved.length === 0
  ? '<p>No issues have been confirmed resolved yet.</p>'
  : `<table class="criteria-table">
  <thead><tr><th scope="col">Issue</th><th scope="col">First detected</th><th scope="col">Resolved</th></tr></thead>
  <tbody>
${resolved.map((r) => `    <tr><td>${escapeHtml(r.message || r.rule_id || 'Issue')}</td><td>${formatDate(r.first_seen_at)}</td><td>${r.resolved_at ? formatDate(r.resolved_at) : '—'}</td></tr>`).join('\n')}
  </tbody>
</table>`}

<hr>
<p><small>${escapeHtml(DISCLAIMER)}</small></p>
`.trim();
}

/* ------------------------------------------------------------------ *
 * Persistence
 * ------------------------------------------------------------------ */

const BUILDERS = {
  statement: buildAccessibilityStatement,
  vpat: buildVpat,
  remediation: buildRemediationRecord,
};

export const DOCUMENT_KINDS = {
  statement: {
    name: 'Accessibility statement',
    description: 'A public statement of conformance. Required for organizations in scope of the European Accessibility Act, and the first thing a plaintiff firm looks for.',
  },
  vpat: {
    name: 'VPAT 2.5 / ACR draft',
    description: 'The Accessibility Conformance Report that enterprise and public-sector buyers request during procurement. Automatable criteria are prefilled.',
  },
  remediation: {
    name: 'Remediation record',
    description: 'A dated audit trail of every issue found and fixed. Evidence of a good-faith, ongoing programme.',
  },
};

export function generateDocument(kind, { orgId, siteId, scanId = null, userId = null }) {
  const builder = BUILDERS[kind];
  if (!builder) throw new Error(`Unknown document kind: ${kind}`);

  const org = get('SELECT * FROM orgs WHERE id = ?', orgId);
  const site = get('SELECT * FROM sites WHERE id = ? AND org_id = ?', siteId, orgId);
  if (!site) throw new Error('Site not found');

  const scan = scanId
    ? get('SELECT * FROM scans WHERE id = ? AND site_id = ?', scanId, siteId)
    : get(`SELECT * FROM scans WHERE site_id = ? AND status = 'complete' ORDER BY created_at DESC LIMIT 1`, siteId);

  if (!scan && kind !== 'remediation') {
    throw new Error('Run a scan before generating this document.');
  }

  const findings = scan ? findingsForScan(scan.id, { limit: 5000 }) : [];
  const content = builder({ org, site, scan, findings });
  const contentHash = createHash('sha256').update(content).digest('hex').slice(0, 16);

  const previous = get(
    `SELECT MAX(version) AS version FROM evidence_docs WHERE site_id = ? AND kind = ?`,
    siteId, kind
  );
  const version = (previous?.version || 0) + 1;
  const id = randomUUID();

  run(
    `INSERT INTO evidence_docs (id, org_id, site_id, kind, version, scan_id, content, content_hash, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, orgId, siteId, kind, version, scan?.id || null, content, contentHash,
    new Date().toISOString(), userId
  );

  return { id, kind, version, contentHash, content };
}

export function listDocuments(siteId) {
  return all(
    `SELECT id, kind, version, content_hash, created_at, scan_id
     FROM evidence_docs WHERE site_id = ? ORDER BY created_at DESC`,
    siteId
  );
}

export function getDocument(id, orgId) {
  return get('SELECT * FROM evidence_docs WHERE id = ? AND org_id = ?', id, orgId);
}

export { DISCLAIMER };
