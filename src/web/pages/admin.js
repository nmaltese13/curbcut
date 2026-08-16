import { html, raw } from '../html.js';
import { page, alert, scoreRing } from '../layout.js';
import { SERVICE_TIERS, SERVICE_STATUSES } from '../../services.js';
import { PLANS } from '../../plans.js';

function ago(iso) {
  if (!iso) return 'never';
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function money(cents) {
  return `$${Number(cents || 0).toLocaleString('en-US')}`;
}

function tabs(current) {
  const items = [
    ['/admin', 'Overview'],
    ['/admin/orgs', 'Accounts'],
    ['/admin/services', 'Service pipeline'],
    ['/admin/leads', 'Leads'],
    ['/admin/activity', 'Activity'],
    ['/admin/email', 'Email'],
  ];
  return html`
    <div class="tabs">
      ${items.map(([href, label]) => html`
        <a href="${href}"${current === href ? raw(' aria-current="page"') : raw('')}>${label}</a>
      `)}
    </div>`;
}

function shell(ctx, current, title, body) {
  return page({
    title: `Admin · ${title}`,
    ctx,
    body: html`
      <div class="wrap" style="padding-top:2rem">
        <div class="row-between" style="margin-bottom:.5rem">
          <h1 style="font-size:1.6rem;margin:0">Admin</h1>
          <span class="badge badge-outline">Staff only</span>
        </div>
        ${tabs(current)}
        ${body}
      </div>`,
  });
}

/* ------------------------------------------------------------------ *
 * Overview
 * ------------------------------------------------------------------ */

export function adminOverviewPage(ctx, { metrics, funnel, mrr, pipeline, recentScans, topIssues }) {
  const body = html`
    <div class="grid grid-4" style="margin-bottom:1.5rem">
      <div class="card stat">
        <p class="stat-value">${money(mrr.total)}</p>
        <p class="stat-label">Monthly recurring revenue</p>
      </div>
      <div class="card stat">
        <p class="stat-value">${String(metrics.orgs)}</p>
        <p class="stat-label">Accounts · ${String(mrr.payingCount)} paying</p>
      </div>
      <div class="card stat">
        <p class="stat-value">${String(metrics.scans)}</p>
        <p class="stat-label">Scans completed</p>
      </div>
      <div class="card stat">
        <p class="stat-value" style="color:var(--success)">${String(metrics.resolved)}</p>
        <p class="stat-label">Issues customers have fixed</p>
      </div>
    </div>

    <div class="grid grid-2" style="margin-bottom:1.5rem">
      <div class="card">
        <h2 style="font-size:1.05rem">Acquisition funnel · last ${String(funnel.days)} days</h2>
        <table>
          <thead><tr><th scope="col">Stage</th><th scope="col">Count</th><th scope="col">Rate</th></tr></thead>
          <tbody>
            <tr><td>Free scans run</td><td>${String(funnel.funnel.publicScans)}</td><td class="muted">—</td></tr>
            <tr><td>Emails captured</td><td>${String(funnel.funnel.emailsCaptured)}</td>
                <td class="muted">${funnel.funnel.publicScans ? `${Math.round((funnel.funnel.emailsCaptured / funnel.funnel.publicScans) * 100)}%` : '—'}</td></tr>
            <tr><td>Signups</td><td>${String(funnel.funnel.signups)}</td><td class="muted">${String(funnel.funnel.scanToSignup)}%</td></tr>
            <tr><td>Paid conversions</td><td>${String(funnel.funnel.paidConversions)}</td><td class="muted">${String(funnel.funnel.signupToPaid)}%</td></tr>
            <tr><td>Service enquiries</td><td>${String(funnel.events.service_requested || 0)}</td><td class="muted">—</td></tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <h2 style="font-size:1.05rem">Service pipeline</h2>
        <p class="muted small">${String(pipeline.openCount)} open · ${money(pipeline.openValue)} quoted</p>
        <table>
          <thead><tr><th scope="col">Stage</th><th scope="col">Requests</th><th scope="col">Value</th></tr></thead>
          <tbody>
            ${SERVICE_STATUSES.map((status) => html`
              <tr>
                <td style="text-transform:capitalize">${status.replace('_', ' ')}</td>
                <td>${String(pipeline.pipeline[status].count)}</td>
                <td class="muted">${money(pipeline.pipeline[status].value)}</td>
              </tr>`)}
          </tbody>
        </table>
        <p style="margin-top:.8rem;margin-bottom:0"><a class="btn btn-secondary btn-sm" href="/admin/services">Work the pipeline</a></p>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <h2 style="font-size:1.05rem">Most common issues across all customers</h2>
        <p class="muted small">What the market actually gets wrong. This is roadmap and content input.</p>
        ${topIssues.length === 0
          ? html`<p class="muted">No scan data yet.</p>`
          : html`
            <table>
              <thead><tr><th scope="col">Rule</th><th scope="col">Occurrences</th><th scope="col">Sites</th></tr></thead>
              <tbody>
                ${topIssues.map((issue) => html`
                  <tr>
                    <td><code>${issue.rule_id}</code></td>
                    <td>${String(issue.occurrences)}</td>
                    <td class="muted">${String(issue.sites)}</td>
                  </tr>`)}
              </tbody>
            </table>`}
      </div>

      <div class="card">
        <h2 style="font-size:1.05rem">Recent scans</h2>
        ${recentScans.length === 0
          ? html`<p class="muted">No scans yet.</p>`
          : html`
            <table>
              <thead><tr><th scope="col">Site</th><th scope="col">Score</th><th scope="col">Issues</th><th scope="col">When</th></tr></thead>
              <tbody>
                ${recentScans.map((scan) => html`
                  <tr>
                    <td style="max-width:180px;overflow-wrap:anywhere">${scan.site_name || '—'}<br><span class="small muted">${scan.org_name || ''}</span></td>
                    <td><strong>${scan.score === null ? '—' : String(scan.score)}</strong></td>
                    <td>${String(scan.findings_count)}</td>
                    <td class="muted small">${ago(scan.created_at)}</td>
                  </tr>`)}
              </tbody>
            </table>`}
      </div>
    </div>
  `;
  return shell(ctx, '/admin', 'Overview', body);
}

/* ------------------------------------------------------------------ *
 * Accounts
 * ------------------------------------------------------------------ */

export function adminOrgsPage(ctx, { orgs }) {
  const body = html`
    <div class="card card-flush table-wrap">
      <table>
        <thead>
          <tr>
            <th scope="col">Account</th><th scope="col">Plan</th><th scope="col">Users</th>
            <th scope="col">Sites</th><th scope="col">Scans</th><th scope="col">Open issues</th>
            <th scope="col">Last activity</th><th scope="col">Joined</th>
          </tr>
        </thead>
        <tbody>
          ${orgs.map((org) => html`
            <tr>
              <td>
                <a href="/admin/orgs/${org.id}"><strong>${org.name}</strong></a><br>
                <span class="small muted">${org.contact_email || '—'}</span>
              </td>
              <td>
                <span class="badge ${org.plan === 'free' ? 'badge-outline' : 'badge-accent'}">${org.plan}</span>
                ${org.billing_status !== 'active' ? html`<br><span class="small muted">${org.billing_status}</span>` : ''}
              </td>
              <td>${String(org.user_count)}</td>
              <td>${String(org.site_count)}</td>
              <td>${String(org.scan_count)}</td>
              <td>${org.open_issues > 0 ? html`<span class="badge badge-critical">${String(org.open_issues)}</span>` : html`<span class="muted">0</span>`}</td>
              <td class="small muted">${ago(org.last_activity)}</td>
              <td class="small muted">${ago(org.created_at)}</td>
            </tr>`)}
        </tbody>
      </table>
    </div>
  `;
  return shell(ctx, '/admin/orgs', 'Accounts', body);
}

export function adminOrgDetailPage(ctx, { org, users, sites, scans, requests, events }) {
  const body = html`
    <p class="small muted"><a href="/admin/orgs">← All accounts</a></p>

    <div class="card" style="margin-bottom:1.5rem">
      <div class="row-between">
        <div>
          <h2 style="margin-bottom:.2rem">${org.name}</h2>
          <p class="muted tight small">
            ${org.contact_email || 'no contact email'} ·
            <span class="badge ${org.plan === 'free' ? 'badge-outline' : 'badge-accent'}">${org.plan}</span> ·
            joined ${ago(org.created_at)}
          </p>
        </div>
        <div class="row">
          ${org.stripe_customer_id ? html`<span class="badge badge-outline">Stripe customer</span>` : ''}
          ${org.trial_ends_at ? html`<span class="badge badge-moderate">Trial ends ${ago(org.trial_ends_at)}</span>` : ''}
        </div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-bottom:1.5rem">
      <div class="card">
        <h3 style="font-size:1rem">Users</h3>
        <table>
          <thead><tr><th scope="col">Email</th><th scope="col">Role</th><th scope="col">Last login</th></tr></thead>
          <tbody>
            ${users.map((u) => html`
              <tr><td>${u.email}</td><td>${u.role}</td><td class="small muted">${ago(u.last_login_at)}</td></tr>`)}
          </tbody>
        </table>
      </div>

      <div class="card">
        <h3 style="font-size:1rem">Sites</h3>
        ${sites.length === 0 ? html`<p class="muted small">No sites yet.</p>` : html`
          <table>
            <thead><tr><th scope="col">Site</th><th scope="col">Score</th><th scope="col">Open</th></tr></thead>
            <tbody>
              ${sites.map((s) => html`
                <tr>
                  <td style="overflow-wrap:anywhere">${s.name}<br><span class="small muted">${s.base_url}</span></td>
                  <td>${s.score === null ? '—' : String(s.score)}</td>
                  <td>${String(s.open_issues)}</td>
                </tr>`)}
            </tbody>
          </table>`}
      </div>
    </div>

    ${requests.length
      ? html`
        <div class="card" style="margin-bottom:1.5rem">
          <h3 style="font-size:1rem">Service requests</h3>
          <table>
            <thead><tr><th scope="col">Type</th><th scope="col">Status</th><th scope="col">When</th></tr></thead>
            <tbody>
              ${requests.map((r) => html`
                <tr><td>${(SERVICE_TIERS[r.kind] || {}).name || r.kind}</td><td>${r.status}</td><td class="small muted">${ago(r.created_at)}</td></tr>`)}
            </tbody>
          </table>
        </div>`
      : ''}

    <div class="grid grid-2">
      <div class="card">
        <h3 style="font-size:1rem">Scan history</h3>
        ${scans.length === 0 ? html`<p class="muted small">No scans yet.</p>` : html`
          <table>
            <thead><tr><th scope="col">When</th><th scope="col">Pages</th><th scope="col">Score</th><th scope="col">Status</th></tr></thead>
            <tbody>
              ${scans.map((s) => html`
                <tr>
                  <td class="small">${ago(s.created_at)}</td>
                  <td>${String(s.pages_scanned)}</td>
                  <td>${s.score === null ? '—' : String(s.score)}</td>
                  <td><span class="badge ${s.status === 'complete' ? 'badge-success' : s.status === 'failed' ? 'badge-critical' : 'badge-outline'}">${s.status}</span></td>
                </tr>`)}
            </tbody>
          </table>`}
      </div>

      <div class="card">
        <h3 style="font-size:1rem">Recent activity</h3>
        <ul class="log" style="max-height:320px">
          ${events.map((e) => html`
            <li class="log-row log-phase">
              <span class="log-tag">${ago(e.created_at)}</span>
              <span class="log-body">${e.name}</span>
            </li>`)}
        </ul>
      </div>
    </div>
  `;
  return shell(ctx, '/admin/orgs', org.name, body);
}

/* ------------------------------------------------------------------ *
 * Service pipeline
 * ------------------------------------------------------------------ */

export function adminServicesPage(ctx, { requests, notice = null }) {
  const body = html`
    ${notice ? alert('success', notice) : ''}
    <p class="muted">Every request someone made for us to do the work. Work these top to bottom.</p>

    ${requests.length === 0
      ? html`<div class="empty"><h3>No service requests yet</h3><p>They arrive from the pricing page and from the button on every scan report.</p></div>`
      : requests.map((r) => html`
        <div class="card" style="margin-bottom:1rem">
          <div class="row-between" style="margin-bottom:.6rem">
            <div>
              <h3 style="font-size:1.02rem;margin-bottom:.15rem">
                ${r.tier.name}
                <span class="badge ${r.status === 'new' ? 'badge-critical' : r.status === 'delivered' || r.status === 'closed' ? 'badge-success' : 'badge-accent'}">${r.status.replace('_', ' ')}</span>
              </h3>
              <p class="small muted tight">
                ${r.contact_email}${r.company ? ` · ${r.company}` : ''} · ${ago(r.created_at)}
                ${r.org_name ? ` · account: ${r.org_name}` : ' · no account'}
              </p>
            </div>
            ${r.quoted_amount ? html`<span class="badge badge-outline">${money(r.quoted_amount)}</span>` : ''}
          </div>

          ${r.site_url ? html`<p class="small tight"><strong>Site:</strong> <span class="mono">${r.site_url}</span></p>` : ''}
          ${r.notes ? html`<p class="small">${r.notes}</p>` : ''}
          ${r.internal_notes ? html`<p class="small muted"><strong>Internal:</strong> ${r.internal_notes}</p>` : ''}

          <form method="post" action="/admin/services/${r.id}" class="row" style="margin-top:.8rem;align-items:flex-end">
            <input type="hidden" name="_csrf" value="${ctx.csrf}">
            <div>
              <label for="status-${r.id}" class="small" style="display:block;font-weight:600">Status</label>
              <select id="status-${r.id}" name="status" style="width:auto">
                ${SERVICE_STATUSES.map((s) => html`
                  <option value="${s}"${s === r.status ? raw(' selected') : raw('')}>${s.replace('_', ' ')}</option>`)}
              </select>
            </div>
            <div>
              <label for="quote-${r.id}" class="small" style="display:block;font-weight:600">Quote ($)</label>
              <input type="text" id="quote-${r.id}" name="quotedAmount" inputmode="numeric"
                     value="${r.quoted_amount || ''}" style="width:110px">
            </div>
            <div style="flex:1 1 220px">
              <label for="notes-${r.id}" class="small" style="display:block;font-weight:600">Internal note</label>
              <input type="text" id="notes-${r.id}" name="internalNotes" placeholder="Next step…">
            </div>
            <button type="submit" class="btn btn-secondary btn-sm">Save</button>
          </form>
        </div>`)}
  `;
  return shell(ctx, '/admin/services', 'Service pipeline', body);
}

/* ------------------------------------------------------------------ *
 * Leads
 * ------------------------------------------------------------------ */

export function adminLeadsPage(ctx, { leads }) {
  const body = html`
    <p class="muted">
      Anonymous scans, worst score first. Someone who scanned their site and saw a low score is the
      warmest outbound list available — they already know they have the problem.
    </p>
    <div class="card card-flush table-wrap">
      <table>
        <thead>
          <tr><th scope="col">Score</th><th scope="col">Site</th><th scope="col">Issues</th><th scope="col">Email</th><th scope="col">When</th></tr>
        </thead>
        <tbody>
          ${leads.length === 0
            ? html`<tr><td colspan="5" class="muted">No free scans yet.</td></tr>`
            : leads.map((lead) => {
                const totals = lead.totals_json ? JSON.parse(lead.totals_json) : {};
                return html`
                  <tr>
                    <td><strong style="color:${raw(lead.score >= 70 ? 'var(--success)' : lead.score >= 40 ? 'var(--serious)' : 'var(--critical)')}">${String(lead.score)}</strong></td>
                    <td style="max-width:280px;overflow-wrap:anywhere">${lead.url}</td>
                    <td>${String(totals.total || 0)} <span class="muted small">(${String(totals.definite || 0)} confirmed)</span></td>
                    <td>${lead.email
                      ? html`<a href="mailto:${lead.email}">${lead.email}</a>`
                      : html`<span class="muted">—</span>`}</td>
                    <td class="small muted">${ago(lead.created_at)}</td>
                  </tr>`;
              })}
        </tbody>
      </table>
    </div>
  `;
  return shell(ctx, '/admin/leads', 'Leads', body);
}

/* ------------------------------------------------------------------ *
 * Activity
 * ------------------------------------------------------------------ */

export function adminActivityPage(ctx, { events, auditRows }) {
  const body = html`
    <div class="grid grid-2">
      <div class="card card-flush">
        <div class="card-header"><h2 style="font-size:1rem">Product events</h2></div>
        <ul class="log" style="max-height:600px">
          ${events.map((e) => html`
            <li class="log-row log-${e.name.includes('fail') ? 'warn' : 'phase'}">
              <span class="log-tag">${ago(e.created_at)}</span>
              <span class="log-body">${e.name}${e.org_name ? ` · ${e.org_name}` : ''}</span>
            </li>`)}
        </ul>
      </div>

      <div class="card card-flush">
        <div class="card-header"><h2 style="font-size:1rem">Audit log</h2></div>
        <ul class="log" style="max-height:600px">
          ${auditRows.map((a) => html`
            <li class="log-row log-phase">
              <span class="log-tag">${ago(a.created_at)}</span>
              <span class="log-body">${a.action}${a.target ? ` · ${String(a.target).slice(0, 20)}` : ''}</span>
            </li>`)}
        </ul>
      </div>
    </div>
  `;
  return shell(ctx, '/admin/activity', 'Activity', body);
}

/* ------------------------------------------------------------------ *
 * Email outbox
 * ------------------------------------------------------------------ */

export function adminEmailPage(ctx, { emails, mode }) {
  const body = html`
    ${mode === 'console'
      ? alert('warn', 'No email provider is configured, so messages are recorded here and logged but not delivered. Set EMAIL_API_KEY to send for real.')
      : alert('info', `Sending through ${mode}.`)}

    <p class="muted">
      Every message the product generates, delivered or not. This is the first place to look when
      someone says they never received a reset link.
    </p>

    <div class="card card-flush table-wrap">
      <table>
        <thead>
          <tr><th scope="col">Status</th><th scope="col">To</th><th scope="col">Subject</th>
              <th scope="col">Template</th><th scope="col">When</th></tr>
        </thead>
        <tbody>
          ${emails.length === 0
            ? html`<tr><td colspan="5" class="muted">No email yet.</td></tr>`
            : emails.map((e) => html`
              <tr>
                <td>
                  <span class="badge ${e.status === 'sent' ? 'badge-success'
                    : e.status === 'failed' ? 'badge-critical' : 'badge-outline'}">${e.status}</span>
                </td>
                <td>${e.to_email}</td>
                <td style="max-width:280px;overflow-wrap:anywhere">
                  ${e.subject}
                  ${e.error ? html`<br><span class="small" style="color:var(--critical)">${e.error}</span>` : ''}
                </td>
                <td><code>${e.template}</code></td>
                <td class="small muted">${ago(e.created_at)}</td>
              </tr>`)}
        </tbody>
      </table>
    </div>
  `;
  return shell(ctx, '/admin/email', 'Email', body);
}
