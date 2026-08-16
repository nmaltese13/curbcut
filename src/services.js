import { randomUUID } from 'node:crypto';
import { get, all, run } from './db.js';
import { track, audit } from './analytics.js';
import log from './log.js';

/**
 * Managed service offerings.
 *
 * The software tiers scale without labor and carry the margin. These tiers do
 * not scale the same way, and that is fine: they exist because automation can
 * only verify part of WCAG, and because some customers would rather buy an
 * outcome than a tool. They also convert at far higher prices, which funds the
 * product, and they are the natural landing spot for the criteria our own
 * reports honestly mark "Not Evaluated".
 */
export const SERVICE_TIERS = {
  audit: {
    id: 'audit',
    name: 'Human-verified audit',
    price: 'From $2,500',
    priceNote: 'one-time, per site',
    summary: 'A qualified reviewer assesses the criteria software cannot judge, and signs off on a complete conformance report.',
    includes: [
      'Everything automated testing found, verified by a person',
      'Manual assessment of the criteria no tool can evaluate',
      'Screen reader and keyboard-only testing',
      'A complete VPAT 2.5 / ACR you can send to procurement',
      'Prioritized remediation plan for your developers',
    ],
    bestFor: 'You need a conformance report a government or enterprise buyer will accept.',
    turnaround: '5–10 business days',
  },

  remediation: {
    id: 'remediation',
    name: 'Done-for-you remediation',
    price: 'From $4,500',
    priceNote: 'scoped per site',
    summary: 'We fix the issues ourselves and hand you tested, reviewable code changes.',
    includes: [
      'Everything in the human-verified audit',
      'We write the fixes, not just the recommendations',
      'Delivered as pull requests against your repository',
      'Re-scan and verification after each merge',
      'Dated remediation record proving the work',
    ],
    bestFor: 'You have a deadline or a demand letter and no developer time to spare.',
    turnaround: '2–4 weeks depending on site size',
  },

  retainer: {
    id: 'retainer',
    name: 'Ongoing compliance partner',
    price: 'From $1,500',
    priceNote: 'per month',
    summary: 'We stay on it: continuous monitoring, monthly review, and fixes as your site changes.',
    includes: [
      'Continuous scanning across all your properties',
      'Monthly human review of new and changed pages',
      'Remediation of new issues as they appear',
      'Refreshed accessibility statement and ACR each quarter',
      'Named contact and a shared Slack channel',
    ],
    bestFor: 'You ship constantly and need compliance to keep up without hiring for it.',
    turnaround: 'Ongoing',
  },
};

export const SERVICE_STATUSES = ['new', 'contacted', 'scoping', 'quoted', 'in_progress', 'delivered', 'closed'];

export function createServiceRequest({
  kind, orgId = null, siteId = null, scanId = null, userId = null,
  contactName = null, contactEmail, company = null, siteUrl = null, notes = null,
}) {
  if (!SERVICE_TIERS[kind]) throw new Error(`Unknown service tier: ${kind}`);
  if (!contactEmail) throw new Error('A contact email is required.');

  const id = randomUUID();
  run(
    `INSERT INTO service_requests
     (id, org_id, site_id, scan_id, user_id, kind, status, contact_name, contact_email, company, site_url, notes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?)`,
    id, orgId, siteId, scanId, userId, kind,
    contactName, String(contactEmail).trim().toLowerCase(), company, siteUrl, notes,
    new Date().toISOString()
  );

  track('service_requested', { orgId, userId, props: { kind, hasScan: Boolean(scanId) } });
  audit('service_requested', { orgId, userId, target: id, meta: { kind } });
  log.info('service request', { id, kind, email: contactEmail, company });

  return id;
}

export function listServiceRequests({ status = null, limit = 100 } = {}) {
  const rows = status
    ? all(
        `SELECT r.*, o.name AS org_name, s.name AS site_name
         FROM service_requests r
         LEFT JOIN orgs o ON o.id = r.org_id
         LEFT JOIN sites s ON s.id = r.site_id
         WHERE r.status = ? ORDER BY r.created_at DESC LIMIT ?`,
        status, limit
      )
    : all(
        `SELECT r.*, o.name AS org_name, s.name AS site_name
         FROM service_requests r
         LEFT JOIN orgs o ON o.id = r.org_id
         LEFT JOIN sites s ON s.id = r.site_id
         ORDER BY r.created_at DESC LIMIT ?`,
        limit
      );
  return rows.map((row) => ({ ...row, tier: SERVICE_TIERS[row.kind] || { name: row.kind } }));
}

export function serviceRequestsForOrg(orgId) {
  return all(
    `SELECT * FROM service_requests WHERE org_id = ? ORDER BY created_at DESC`,
    orgId
  ).map((row) => ({ ...row, tier: SERVICE_TIERS[row.kind] || { name: row.kind } }));
}

export function updateServiceRequest(id, { status, internalNotes, quotedAmount }) {
  const existing = get('SELECT * FROM service_requests WHERE id = ?', id);
  if (!existing) return null;
  if (status && !SERVICE_STATUSES.includes(status)) throw new Error(`Invalid status: ${status}`);

  run(
    `UPDATE service_requests
     SET status = COALESCE(?, status),
         internal_notes = COALESCE(?, internal_notes),
         quoted_amount = COALESCE(?, quoted_amount),
         updated_at = ?
     WHERE id = ?`,
    status || null,
    internalNotes ?? null,
    quotedAmount === undefined || quotedAmount === null || quotedAmount === '' ? null : Number(quotedAmount),
    new Date().toISOString(),
    id
  );
  return get('SELECT * FROM service_requests WHERE id = ?', id);
}

/** Pipeline counts for the admin dashboard. */
export function servicePipeline() {
  const rows = all(`SELECT status, COUNT(*) AS count, SUM(COALESCE(quoted_amount, 0)) AS value
                    FROM service_requests GROUP BY status`);
  const pipeline = Object.fromEntries(SERVICE_STATUSES.map((s) => [s, { count: 0, value: 0 }]));
  for (const row of rows) {
    pipeline[row.status] = { count: row.count, value: row.value || 0 };
  }
  const open = SERVICE_STATUSES.filter((s) => !['delivered', 'closed'].includes(s));
  return {
    pipeline,
    openCount: open.reduce((sum, s) => sum + pipeline[s].count, 0),
    openValue: open.reduce((sum, s) => sum + pipeline[s].value, 0),
  };
}

export default SERVICE_TIERS;
