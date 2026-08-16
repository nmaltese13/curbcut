import { randomUUID } from 'node:crypto';
import { run, all, get } from './db.js';
import config from './config.js';
import log from './log.js';
import { escapeHtml } from './web/html.js';

/**
 * Outbound email.
 *
 * Two rules shape this module. First, mail is never required for the product to
 * work: with no provider configured everything still functions and messages are
 * written to the outbox and the log, so a developer can copy a reset link
 * straight out of the console. Second, every message is recorded regardless of
 * transport, because "did the customer actually get it?" is the first question
 * support ever asks.
 *
 * Providers are plain REST calls, so there is no SDK dependency.
 */

const PROVIDERS = {
  resend: {
    url: 'https://api.resend.com/emails',
    headers: (key) => ({ Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }),
    body: ({ from, to, subject, html, text }) => JSON.stringify({ from, to: [to], subject, html, text }),
    id: (payload) => payload?.id || null,
  },
  postmark: {
    url: 'https://api.postmarkapp.com/email',
    headers: (key) => ({ 'X-Postmark-Server-Token': key, 'Content-Type': 'application/json', Accept: 'application/json' }),
    body: ({ from, to, subject, html, text }) => JSON.stringify({
      From: from, To: to, Subject: subject, HtmlBody: html, TextBody: text, MessageStream: 'outbound',
    }),
    id: (payload) => payload?.MessageID || null,
  },
};

export function emailEnabled() {
  return Boolean(config.email.apiKey && PROVIDERS[config.email.provider]);
}

export function emailMode() {
  return emailEnabled() ? config.email.provider : 'console';
}

/* ------------------------------------------------------------------ *
 * Templates
 * ------------------------------------------------------------------ */

const BASE_STYLES = `
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  line-height: 1.6; color: #14182a; max-width: 560px; margin: 0 auto; padding: 24px;
`.replace(/\s+/g, ' ').trim();

/** Wrap body content in a simple, high-contrast, accessible shell. */
function layout({ title, body, footer }) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#f6f7fb;">
<div style="${BASE_STYLES}">
  <p style="font-weight:700;font-size:18px;margin:0 0 24px;color:#2440c4;">Curbcut</p>
  ${body}
  <hr style="border:none;border-top:1px solid #d9dee9;margin:32px 0 16px;">
  <p style="font-size:13px;color:#4d5670;margin:0;">${footer || 'Curbcut — find it, fix it, prove it.'}</p>
</div>
</body></html>`;
}

function button(href, label) {
  return `<p style="margin:24px 0;">
    <a href="${escapeHtml(href)}" style="background:#2440c4;color:#ffffff;text-decoration:none;
       padding:12px 20px;border-radius:8px;font-weight:600;display:inline-block;">${escapeHtml(label)}</a>
  </p>
  <p style="font-size:13px;color:#4d5670;">If the button does not work, paste this into your browser:<br>
    <span style="word-break:break-all;">${escapeHtml(href)}</span></p>`;
}

export const TEMPLATES = {
  password_reset: ({ resetUrl, expiresMinutes }) => ({
    subject: 'Reset your Curbcut password',
    html: layout({
      title: 'Reset your password',
      body: `<h1 style="font-size:20px;margin:0 0 12px;">Reset your password</h1>
        <p>Someone asked to reset the password for this Curbcut account. If that was you, use the link below.</p>
        ${button(resetUrl, 'Choose a new password')}
        <p>This link expires in ${expiresMinutes} minutes and can only be used once.</p>
        <p style="color:#4d5670;">If you did not request this, you can ignore this email. Your password will not change.</p>`,
    }),
    text: `Reset your Curbcut password\n\nUse this link to choose a new password:\n${resetUrl}\n\n`
      + `It expires in ${expiresMinutes} minutes and can only be used once.\n\n`
      + `If you did not request this, ignore this email — your password will not change.`,
  }),

  invitation: ({ inviteUrl, orgName, invitedBy, expiresDays }) => ({
    subject: `You have been invited to ${orgName} on Curbcut`,
    html: layout({
      title: 'Team invitation',
      body: `<h1 style="font-size:20px;margin:0 0 12px;">Join ${escapeHtml(orgName)}</h1>
        <p>${escapeHtml(invitedBy || 'A teammate')} invited you to work on accessibility compliance in Curbcut.</p>
        ${button(inviteUrl, 'Accept the invitation')}
        <p>This invitation expires in ${expiresDays} days.</p>`,
    }),
    text: `Join ${orgName} on Curbcut\n\n${invitedBy || 'A teammate'} invited you.\n\n${inviteUrl}\n\n`
      + `This invitation expires in ${expiresDays} days.`,
  }),

  scan_complete: ({ siteName, siteUrl, score, previousScore, totals, reportUrl, newIssues, resolvedIssues }) => {
    const direction = previousScore === null || previousScore === undefined
      ? null
      : score - previousScore;
    const movement = direction === null
      ? ''
      : direction > 0 ? ` (up ${direction} points)` : direction < 0 ? ` (down ${Math.abs(direction)} points)` : ' (unchanged)';

    return {
      subject: newIssues > 0
        ? `${newIssues} new accessibility ${newIssues === 1 ? 'issue' : 'issues'} on ${siteName}`
        : `${siteName} scan complete — score ${score}`,
      html: layout({
        title: 'Scan complete',
        body: `<h1 style="font-size:20px;margin:0 0 12px;">${escapeHtml(siteName)} scored ${score}/100${escapeHtml(movement)}</h1>
          <p style="color:#4d5670;">${escapeHtml(siteUrl)}</p>
          <table style="width:100%;border-collapse:collapse;margin:20px 0;">
            <tr><td style="padding:6px 0;">Confirmed failures</td><td style="text-align:right;font-weight:600;">${totals.definite || 0}</td></tr>
            <tr><td style="padding:6px 0;">Need review</td><td style="text-align:right;font-weight:600;">${totals.review || 0}</td></tr>
            <tr><td style="padding:6px 0;">Recommendations</td><td style="text-align:right;font-weight:600;">${totals.advisory || 0}</td></tr>
            ${newIssues ? `<tr><td style="padding:6px 0;color:#b3261e;">New since last scan</td><td style="text-align:right;font-weight:700;color:#b3261e;">${newIssues}</td></tr>` : ''}
            ${resolvedIssues ? `<tr><td style="padding:6px 0;color:#0f6d43;">Confirmed fixed</td><td style="text-align:right;font-weight:700;color:#0f6d43;">${resolvedIssues}</td></tr>` : ''}
          </table>
          ${button(reportUrl, 'View the report')}
          <p style="font-size:13px;color:#4d5670;">Automated testing detects a subset of accessibility barriers. Criteria needing human review are listed separately in the report.</p>`,
      }),
      text: `${siteName} scored ${score}/100${movement}\n${siteUrl}\n\n`
        + `Confirmed failures: ${totals.definite || 0}\nNeed review: ${totals.review || 0}\n`
        + `Recommendations: ${totals.advisory || 0}\n`
        + (newIssues ? `New since last scan: ${newIssues}\n` : '')
        + (resolvedIssues ? `Confirmed fixed: ${resolvedIssues}\n` : '')
        + `\n${reportUrl}`,
    };
  },

  public_scan_report: ({ url, score, totals, reportUrl }) => ({
    subject: `Accessibility scan for ${url} — score ${score}/100`,
    html: layout({
      title: 'Your scan report',
      body: `<h1 style="font-size:20px;margin:0 0 12px;">${escapeHtml(url)} scored ${score}/100</h1>
        <p>We found <strong>${totals.definite || 0} confirmed ${totals.definite === 1 ? 'failure' : 'failures'}</strong>
           and ${totals.review || 0} ${totals.review === 1 ? 'issue' : 'issues'} needing human review.</p>
        ${button(reportUrl, 'See the full report')}
        <p>Create a free account to scan your whole site and get the code changes that fix the mechanical failures.</p>`,
    }),
    text: `${url} scored ${score}/100\n\n${totals.definite || 0} confirmed failures, ${totals.review || 0} need review.\n\n${reportUrl}`,
  }),
};

/* ------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------ */

/**
 * Render and deliver a message. Never throws: a failed email must not fail the
 * user action that triggered it. Failures are recorded on the outbox row.
 */
export async function sendEmail({ to, template, data = {}, orgId = null }) {
  const builder = TEMPLATES[template];
  if (!builder) throw new Error(`Unknown email template: ${template}`);

  const rendered = builder(data);
  const id = randomUUID();
  const now = new Date().toISOString();

  run(
    `INSERT INTO email_outbox (id, to_email, subject, template, body_html, body_text, status, org_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
    id, to, rendered.subject, template, rendered.html, rendered.text, orgId, now
  );

  if (!emailEnabled()) {
    // Development and unconfigured deployments: make the content findable
    // rather than pretending it was delivered.
    run(`UPDATE email_outbox SET status = 'logged', provider = 'console', sent_at = ? WHERE id = ?`, now, id);
    log.info('email (not sent — no provider configured)', { to, subject: rendered.subject, template });
    if (!config.isProd) {
      const link = (rendered.text.match(/https?:\/\/\S+/) || [])[0];
      if (link) process.stdout.write(`\n  ✉  ${template} for ${to}\n     ${link}\n\n`);
    }
    return { id, sent: false, mode: 'console' };
  }

  const provider = PROVIDERS[config.email.provider];
  try {
    const response = await fetch(provider.url, {
      method: 'POST',
      headers: provider.headers(config.email.apiKey),
      body: provider.body({
        from: config.email.from,
        to,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      }),
      signal: AbortSignal.timeout(15000),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.message || payload?.Message || `HTTP ${response.status}`;
      run(`UPDATE email_outbox SET status = 'failed', provider = ?, error = ? WHERE id = ?`,
        config.email.provider, String(message).slice(0, 400), id);
      log.error('email send failed', { to, template, error: message });
      return { id, sent: false, error: message };
    }

    run(
      `UPDATE email_outbox SET status = 'sent', provider = ?, provider_id = ?, sent_at = ? WHERE id = ?`,
      config.email.provider, provider.id(payload), new Date().toISOString(), id
    );
    log.info('email sent', { to, template, provider: config.email.provider });
    return { id, sent: true, mode: config.email.provider };
  } catch (err) {
    run(`UPDATE email_outbox SET status = 'failed', provider = ?, error = ? WHERE id = ?`,
      config.email.provider, err.message.slice(0, 400), id);
    log.error('email send threw', { to, template, error: err.message });
    return { id, sent: false, error: err.message };
  }
}

export function recentEmails(limit = 100) {
  return all(
    `SELECT id, to_email, subject, template, status, provider, error, created_at, sent_at
     FROM email_outbox ORDER BY created_at DESC LIMIT ?`,
    limit
  );
}

export function getEmail(id) {
  return get('SELECT * FROM email_outbox WHERE id = ?', id);
}

export default sendEmail;
