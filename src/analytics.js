import { randomUUID } from 'node:crypto';
import { run, all, get } from './db.js';
import log from './log.js';

/**
 * First-party event tracking.
 *
 * Funnel questions ("how many free scans convert to signups?") decide where the
 * marketing budget goes, so the events are stored locally rather than sent to a
 * third party. That also avoids putting a tracking script on a product whose
 * whole promise is a fast, accessible page.
 */

const KNOWN_EVENTS = new Set([
  'public_scan_started', 'public_scan_completed', 'public_scan_failed', 'public_scan_email_captured',
  'signup_started', 'signup_completed', 'login', 'logout',
  'site_created', 'scan_started', 'scan_completed', 'scan_failed',
  'fix_plan_viewed', 'patch_downloaded', 'finding_status_changed',
  'evidence_generated', 'evidence_downloaded',
  'plan_viewed', 'checkout_started', 'plan_changed',
  'api_key_created', 'api_scan_requested',
]);

export function track(name, { orgId = null, userId = null, props = {} } = {}) {
  try {
    if (!KNOWN_EVENTS.has(name)) log.warn('unknown analytics event', { name });
    run(
      `INSERT INTO events (id, org_id, user_id, name, props_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      randomUUID(), orgId, userId, name, JSON.stringify(props || {}), new Date().toISOString()
    );
  } catch (err) {
    // Analytics must never break a user-facing request.
    log.error('analytics write failed', { name, error: err.message });
  }
}

export function audit(action, { orgId = null, userId = null, target = null, meta = {}, ip = null } = {}) {
  try {
    run(
      `INSERT INTO audit_log (id, org_id, user_id, action, target, meta_json, ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(), orgId, userId, action, target, JSON.stringify(meta || {}), ip, new Date().toISOString()
    );
  } catch (err) {
    log.error('audit write failed', { action, error: err.message });
  }
}

/** Funnel counts for the admin dashboard. */
export function funnelSummary(days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  const counts = all(
    `SELECT name, COUNT(*) AS count FROM events WHERE created_at >= ? GROUP BY name`,
    since
  );
  const byName = Object.fromEntries(counts.map((row) => [row.name, row.count]));

  const publicScans = byName.public_scan_completed || 0;
  const signups = byName.signup_completed || 0;
  const paid = byName.plan_changed || 0;

  return {
    days,
    events: byName,
    funnel: {
      publicScans,
      emailsCaptured: byName.public_scan_email_captured || 0,
      signups,
      paidConversions: paid,
      scanToSignup: publicScans ? Math.round((signups / publicScans) * 1000) / 10 : 0,
      signupToPaid: signups ? Math.round((paid / signups) * 1000) / 10 : 0,
    },
  };
}

export function recentEvents(limit = 100) {
  return all(
    `SELECT e.*, o.name AS org_name FROM events e
     LEFT JOIN orgs o ON o.id = e.org_id
     ORDER BY e.created_at DESC LIMIT ?`,
    limit
  );
}

/** Headline business metrics. */
export function businessMetrics() {
  const orgs = get(`SELECT COUNT(*) AS count FROM orgs`).count;
  const paying = all(`SELECT plan, COUNT(*) AS count FROM orgs WHERE plan != 'free' GROUP BY plan`);
  const users = get(`SELECT COUNT(*) AS count FROM users`).count;
  const sites = get(`SELECT COUNT(*) AS count FROM sites WHERE archived_at IS NULL`).count;
  const scans = get(`SELECT COUNT(*) AS count FROM scans WHERE status = 'complete'`).count;
  const findings = get(`SELECT COUNT(*) AS count FROM findings`).count;
  const resolved = get(`SELECT COUNT(*) AS count FROM finding_states WHERE status = 'resolved'`).count;
  const publicScans = get(`SELECT COUNT(*) AS count FROM public_scans`).count;
  const leads = get(`SELECT COUNT(*) AS count FROM public_scans WHERE email IS NOT NULL`).count;

  return { orgs, paying, users, sites, scans, findings, resolved, publicScans, leads };
}

export default { track, audit };
