import { get, all, run } from './db.js';
import config from './config.js';
import log from './log.js';
import { runScan, createScan } from './scan/runner.js';
import { getPlan, checkLimit } from './plans.js';
import { effectivePlanId } from './billing.js';
import { sendEmail } from './email.js';
import { purgeExpiredSessions, purgeExpiredTokens } from './auth.js';
import { track } from './analytics.js';

/**
 * Recurring scans.
 *
 * This is what turns the product from a dashboard someone remembers to open
 * into infrastructure that reports to them. A site is only worth monitoring if
 * monitoring happens without anyone asking.
 *
 * Deliberately a single in-process timer rather than a job queue. At this scale
 * a queue is unjustified complexity; the schema stores `next_scan_at` on the
 * site, so moving to a real worker later is a change of caller, not of model.
 */

export const FREQUENCIES = {
  manual: { id: 'manual', label: 'Manual only', hours: null, minPlan: 'free' },
  weekly: { id: 'weekly', label: 'Every week', hours: 168, minPlan: 'starter' },
  daily: { id: 'daily', label: 'Every day', hours: 24, minPlan: 'growth' },
  sixhourly: { id: 'sixhourly', label: 'Every 6 hours', hours: 6, minPlan: 'scale' },
};

const PLAN_RANK = { free: 0, starter: 1, growth: 2, scale: 3 };

export function frequencyAllowed(planId, frequencyId) {
  const frequency = FREQUENCIES[frequencyId];
  if (!frequency) return false;
  return (PLAN_RANK[planId] ?? 0) >= (PLAN_RANK[frequency.minPlan] ?? 0);
}

export function availableFrequencies(planId) {
  return Object.values(FREQUENCIES).filter((f) => frequencyAllowed(planId, f.id));
}

function nextRunFrom(frequencyId, from = Date.now()) {
  const frequency = FREQUENCIES[frequencyId];
  if (!frequency || !frequency.hours) return null;
  return new Date(from + frequency.hours * 60 * 60 * 1000).toISOString();
}

/** Set a site's cadence and compute when it should next run. */
export function setSchedule(siteId, frequencyId) {
  const frequency = FREQUENCIES[frequencyId] ? frequencyId : 'manual';
  run(
    'UPDATE sites SET scan_frequency = ?, next_scan_at = ? WHERE id = ?',
    frequency, nextRunFrom(frequency), siteId
  );
  return frequency;
}

/** Sites whose scheduled time has arrived. */
export function dueSites(now = new Date()) {
  return all(
    `SELECT s.*, o.plan, o.billing_status, o.trial_ends_at, o.stripe_subscription_id, o.id AS org_id
     FROM sites s JOIN orgs o ON o.id = s.org_id
     WHERE s.archived_at IS NULL
       AND s.scan_frequency != 'manual'
       AND s.next_scan_at IS NOT NULL
       AND s.next_scan_at <= ?
     ORDER BY s.next_scan_at
     LIMIT 20`,
    now.toISOString()
  );
}

/**
 * Compare the finished scan against the one before it so the notification can
 * say what actually changed rather than just restating the score.
 */
function changeSummary(siteId, scanId) {
  const previous = get(
    `SELECT id, score FROM scans WHERE site_id = ? AND status = 'complete' AND id != ?
     ORDER BY created_at DESC LIMIT 1`,
    siteId, scanId
  );

  const newIssues = get(
    `SELECT COUNT(*) AS count FROM finding_states
     WHERE site_id = ? AND status = 'open' AND first_seen_at >= (
       SELECT COALESCE(started_at, created_at) FROM scans WHERE id = ?
     )`,
    siteId, scanId
  ).count;

  const resolvedIssues = get(
    `SELECT COUNT(*) AS count FROM finding_states
     WHERE site_id = ? AND status = 'resolved' AND resolved_scan_id = ?`,
    siteId, scanId
  ).count;

  return { previousScore: previous ? previous.score : null, newIssues, resolvedIssues };
}

/** Email the org about a completed scheduled scan. */
async function notify(site, scanId) {
  if (!site.notify_emails) return;

  const scan = get('SELECT * FROM scans WHERE id = ?', scanId);
  if (!scan || scan.status !== 'complete') return;

  const totals = scan.totals_json ? JSON.parse(scan.totals_json) : {};
  const { previousScore, newIssues, resolvedIssues } = changeSummary(site.id, scanId);

  // Quiet by default: only write when something changed or the score moved.
  const scoreMoved = previousScore !== null && previousScore !== scan.score;
  if (!newIssues && !resolvedIssues && !scoreMoved) {
    log.debug('scheduled scan unchanged, no email sent', { siteId: site.id });
    return;
  }

  const recipients = all(
    `SELECT u.email FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.org_id = ?`,
    site.org_id
  ).map((row) => row.email);

  for (const to of recipients) {
    await sendEmail({
      to,
      template: 'scan_complete',
      orgId: site.org_id,
      data: {
        siteName: site.name,
        siteUrl: site.base_url,
        score: scan.score,
        previousScore,
        totals,
        newIssues,
        resolvedIssues,
        reportUrl: `${config.appUrl}/app/scans/${scanId}`,
      },
    });
  }
}

/** Run one scheduler pass. Exported so tests can drive it directly. */
export async function tick({ now = new Date() } = {}) {
  const due = dueSites(now);
  const results = [];

  for (const site of due) {
    // Reschedule first. If the scan throws, we must not retry in a hot loop.
    run('UPDATE sites SET next_scan_at = ? WHERE id = ?', nextRunFrom(site.scan_frequency, now.getTime()), site.id);

    const plan = effectivePlanId(site);

    // A downgraded or expired account should stop consuming scan capacity.
    if (!frequencyAllowed(plan, site.scan_frequency)) {
      log.info('scheduled scan skipped: plan no longer includes this cadence', {
        siteId: site.id, plan, frequency: site.scan_frequency,
      });
      run(`UPDATE sites SET scan_frequency = 'manual', next_scan_at = NULL WHERE id = ?`, site.id);
      results.push({ siteId: site.id, skipped: 'plan' });
      continue;
    }

    const period = now.toISOString().slice(0, 7);
    const used = get(
      `SELECT COUNT(*) AS count FROM scans WHERE org_id = ? AND created_at >= ?`,
      site.org_id, `${period}-01`
    ).count;

    if (!checkLimit(plan, 'scansPerMonth', used).allowed) {
      log.info('scheduled scan skipped: monthly quota reached', { siteId: site.id, plan, used });
      results.push({ siteId: site.id, skipped: 'quota' });
      continue;
    }

    try {
      const scanId = createScan(site.id, { trigger: 'scheduled' });
      await runScan(site.id, { trigger: 'scheduled', scanId });
      track('scheduled_scan_completed', { orgId: site.org_id, props: { siteId: site.id } });
      await notify(site, scanId);
      results.push({ siteId: site.id, scanId, ok: true });
    } catch (err) {
      log.warn('scheduled scan failed', { siteId: site.id, error: err.message });
      results.push({ siteId: site.id, error: err.message });
    }
  }

  return results;
}

let timer = null;
let running = false;

export function startScheduler() {
  if (!config.scheduler.enabled || timer) return;

  timer = setInterval(async () => {
    // Overlapping passes would double-scan a site whose scan outlives the interval.
    if (running) return;
    running = true;
    try {
      const results = await tick();
      if (results.length) log.info('scheduler pass complete', { scans: results.length });
      purgeExpiredSessions();
      purgeExpiredTokens();
    } catch (err) {
      log.error('scheduler pass failed', { error: err.message });
    } finally {
      running = false;
    }
  }, config.scheduler.intervalMs);

  timer.unref();
  log.info('scheduler started', { intervalMs: config.scheduler.intervalMs });
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

export default { tick, startScheduler, stopScheduler, setSchedule, FREQUENCIES };
