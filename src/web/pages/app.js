import { html, raw } from '../html.js';
import { page, scoreRing, impactBadge, confidenceBadge, alert, renderDiff, scoreColor } from '../layout.js';
import { PLANS, PLAN_ORDER, getPlan } from '../../plans.js';
import { DOCUMENT_KINDS } from '../../evidence/documents.js';
import { coverageStats } from '../../evidence/wcag.js';
import { trialStatus, billingMode } from '../../billing.js';

const coverage = coverageStats();

/**
 * Human-friendly timestamp. Handles both directions: scheduled scans are in the
 * future, and rendering those as "just now" reads as though they already ran.
 */
function relativeTime(iso) {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const future = diff < 0;
  const minutes = Math.round(Math.abs(diff) / 60000);
  const phrase = (value) => (future ? `in ${value}` : `${value} ago`);

  if (minutes < 1) return future ? 'in under a minute' : 'just now';
  if (minutes < 60) return phrase(`${minutes}m`);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return phrase(`${hours}h`);
  const days = Math.round(hours / 24);
  if (days < 30) return phrase(`${days}d`);
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function trialBanner(org) {
  const trial = trialStatus(org);
  if (!trial) return '';
  if (trial.expired) {
    return alert('warn', 'Your trial has ended. Choose a plan to keep code fixes and evidence documents.');
  }
  return html`
    <div class="alert alert-info" role="status">
      <p><strong>${String(trial.days)} days left</strong> in your Growth trial — code fixes, VPAT drafts and API access are all unlocked.
      <a href="/app/settings/billing">Choose a plan</a></p>
    </div>`;
}

/* ------------------------------------------------------------------ *
 * Dashboard
 * ------------------------------------------------------------------ */

export function dashboardPage(ctx, { sites, org, notice = null }) {
  const body = html`
    <div class="wrap" style="padding-top:2rem">
      ${notice ? alert('success', notice) : ''}
      ${trialBanner(org)}

      <div class="row-between" style="margin-bottom:1.5rem">
        <div>
          <h1 style="margin-bottom:.2rem">Sites</h1>
          <p class="muted tight">${org.name} · ${getPlan(org.plan).name} plan</p>
        </div>
        <a class="btn btn-primary" href="/app/sites/new">Add a site</a>
      </div>

      ${sites.length === 0
        ? html`
          <div class="empty">
            <h3>Add your first site</h3>
            <p style="max-width:44ch;margin-inline:auto">
              Point Curbcut at a public URL. We'll crawl it, test every page against WCAG 2.1 AA,
              and show you exactly what to fix.
            </p>
            <a class="btn btn-primary btn-lg" href="/app/sites/new">Add a site</a>
          </div>`
        : html`
          <div class="grid grid-2">
            ${sites.map((site) => html`
              <a class="card card-link" href="/app/sites/${site.id}">
                <div class="row" style="gap:1.1rem;align-items:flex-start">
                  ${site.score !== null && site.score !== undefined
                    ? scoreRing(site.score, { small: true, label: `Score for ${site.name}` })
                    : html`<div class="score score-sm" style="--score:0;--score-color:var(--bg-inset)"><span class="score-value" aria-hidden="true">—</span></div>`}
                  <div style="min-width:0;flex:1">
                    <h3 style="margin-bottom:.15rem">${site.name}</h3>
                    <p class="small muted tight" style="overflow-wrap:anywhere">${site.base_url}</p>
                    <div class="row" style="margin-top:.6rem">
                      ${site.open_issues > 0
                        ? html`<span class="badge badge-critical">${String(site.open_issues)} open</span>`
                        : html`<span class="badge badge-success">No open issues</span>`}
                      <span class="small muted">Scanned ${relativeTime(site.last_scan_at)}</span>
                    </div>
                  </div>
                </div>
              </a>
            `)}
          </div>`}
    </div>
  `;

  return page({ title: 'Dashboard', body, ctx });
}

export function newSitePage(ctx, { error = null, values = {}, limitMessage = null }) {
  const body = html`
    <div class="wrap-narrow" style="padding:2.5rem 1.25rem;max-width:560px">
      <p class="small muted"><a href="/app">← Sites</a></p>
      <h1>Add a site</h1>
      ${error ? alert('error', error) : ''}
      ${limitMessage ? alert('warn', limitMessage) : ''}

      <form method="post" action="/app/sites/new" class="card">
        <input type="hidden" name="_csrf" value="${ctx.csrf}">
        <div class="field">
          <label for="site-url">Website URL</label>
          <input type="url" id="site-url" name="baseUrl" required placeholder="https://yourcompany.com"
                 value="${values.baseUrl || ''}" autocomplete="url">
          <p class="hint">We crawl same-origin pages from here and respect your robots.txt.</p>
        </div>
        <div class="field">
          <label for="site-name">Display name</label>
          <input type="text" id="site-name" name="name" placeholder="Marketing site" value="${values.name || ''}">
          <p class="hint">Optional. We'll use the domain if you leave this blank.</p>
        </div>
        <div class="field">
          <label for="site-pages">Pages to crawl per scan</label>
          <select id="site-pages" name="maxPages">
            <option value="10">10 pages — quick check</option>
            <option value="25" selected>25 pages — recommended</option>
            <option value="100">100 pages</option>
            <option value="250">250 pages</option>
          </select>
          <p class="hint">Your ${getPlan(ctx.org.plan).name} plan allows up to ${String(getPlan(ctx.org.plan).limits.pagesPerScan)} pages per scan.</p>
        </div>
        <button type="submit" class="btn btn-primary btn-lg">Add site and scan</button>
      </form>
    </div>
  `;
  return page({ title: 'Add a site', body, ctx });
}

/* ------------------------------------------------------------------ *
 * Site overview
 * ------------------------------------------------------------------ */

export function sitePage(ctx, { site, latestScan, history, ledger, documents, frequencies = [], allFrequencies = [], error = null, notice = null }) {
  const totals = latestScan?.totals_json ? JSON.parse(latestScan.totals_json) : null;
  const coverageInfo = latestScan?.coverage_json ? JSON.parse(latestScan.coverage_json) : null;

  const maxIssues = Math.max(1, ...history.map((h) => h.totals.total || 0));

  const body = html`
    <div class="wrap" style="padding-top:2rem">
      <p class="small muted"><a href="/app">← Sites</a></p>
      ${error ? alert('error', error) : ''}
      ${notice ? alert('success', notice) : ''}

      <div class="row-between" style="margin-bottom:1.5rem">
        <div style="min-width:0">
          <h1 style="margin-bottom:.2rem">${site.name}</h1>
          <p class="muted tight" style="overflow-wrap:anywhere">
            <a href="${site.base_url}" rel="noopener noreferrer nofollow">${site.base_url}</a>
          </p>
        </div>
        <form method="post" action="/app/sites/${site.id}/scan">
          <input type="hidden" name="_csrf" value="${ctx.csrf}">
          <button type="submit" class="btn btn-primary">Run a scan</button>
        </form>
      </div>

      ${!latestScan
        ? html`
          <div class="empty">
            <h3>No scans yet</h3>
            <p>Run your first scan to see where this site stands.</p>
            <form method="post" action="/app/sites/${site.id}/scan">
              <input type="hidden" name="_csrf" value="${ctx.csrf}">
              <button type="submit" class="btn btn-primary btn-lg">Run a scan</button>
            </form>
          </div>`
        : html`
          <div class="grid grid-2" style="margin-bottom:1.5rem">
            <div class="card">
              <div class="row" style="gap:1.25rem">
                ${scoreRing(latestScan.score)}
                <div>
                  <h2 style="font-size:1.1rem;margin-bottom:.3rem">Latest scan</h2>
                  <p class="small muted tight">
                    ${String(latestScan.pages_scanned)} pages · ${relativeTime(latestScan.finished_at)}
                  </p>
                  <div class="row" style="margin-top:.6rem">
                    <span class="badge badge-critical">${String(totals?.definite || 0)} confirmed</span>
                    <span class="badge badge-outline">${String(totals?.review || 0)} to review</span>
                  </div>
                  <p style="margin-top:.8rem;margin-bottom:0">
                    <a class="btn btn-secondary btn-sm" href="/app/scans/${latestScan.id}">View report</a>
                    <a class="btn btn-secondary btn-sm" href="/app/scans/${latestScan.id}/fixes">Fix plan</a>
                  </p>
                </div>
              </div>
            </div>

            <div class="card">
              <h2 style="font-size:1.1rem">Remediation ledger</h2>
              <p class="small muted">Tracked from first detection to confirmed resolution.</p>
              <div class="grid grid-3" style="gap:.5rem;margin-top:1rem">
                <div><p class="stat-value" style="font-size:1.5rem">${String(ledger.open)}</p><p class="stat-label">Open</p></div>
                <div><p class="stat-value" style="font-size:1.5rem;color:var(--success)">${String(ledger.resolved)}</p><p class="stat-label">Resolved</p></div>
                <div><p class="stat-value" style="font-size:1.5rem">${String(ledger.wontfix)}</p><p class="stat-label">Accepted</p></div>
              </div>
            </div>
          </div>

          ${coverageInfo && !coverageInfo.complete ? alert('warn', coverageInfo.note) : ''}

          ${history.length > 1
            ? html`
              <div class="card" style="margin-bottom:1.5rem">
                <h2 style="font-size:1.1rem">Trend</h2>
                <table>
                  <caption class="visually-hidden">Scan history showing score and issue count over time</caption>
                  <thead>
                    <tr><th scope="col">Date</th><th scope="col">Score</th><th scope="col">Issues</th><th scope="col">Pages</th><th scope="col"></th></tr>
                  </thead>
                  <tbody>
                    ${history.slice().reverse().slice(0, 10).map((scan) => html`
                      <tr>
                        <td>${relativeTime(scan.finished_at)}</td>
                        <td><strong style="color:${raw(scoreColor(scan.score))}">${String(scan.score)}</strong></td>
                        <td>
                          <div class="row" style="gap:.5rem;flex-wrap:nowrap">
                            <span style="min-width:2.5rem">${String(scan.totals.total)}</span>
                            <span class="progress" style="width:100px" role="img" aria-label="${String(scan.totals.total)} issues">
                              <span class="progress-bar" style="width:${String(Math.round((scan.totals.total / maxIssues) * 100))}%;background:${raw(scoreColor(scan.score))}"></span>
                            </span>
                          </div>
                        </td>
                        <td>${String(scan.pages_scanned)}</td>
                        <td><a href="/app/scans/${scan.id}">View</a></td>
                      </tr>
                    `)}
                  </tbody>
                </table>
              </div>`
            : ''}
        `}

      <div class="card">
        <div class="card-header" style="padding:0 0 1rem;border-bottom:1px solid var(--border);margin-bottom:1rem">
          <h2 style="font-size:1.1rem">Evidence documents</h2>
        </div>
        ${!ctx.planFeatures.evidence
          ? html`<p class="muted">Evidence documents are available on paid plans.
              <a href="/app/settings/billing">See plans</a></p>`
          : html`
            <div class="grid grid-3">
              ${Object.entries(DOCUMENT_KINDS).map(([kind, meta]) => {
                const existing = documents.filter((d) => d.kind === kind);
                return html`
                  <div>
                    <h3 style="font-size:.98rem">${meta.name}</h3>
                    <p class="small muted">${meta.description}</p>
                    ${existing.length
                      ? html`<p class="small">
                          <a href="/app/evidence/${existing[0].id}">View v${String(existing[0].version)}</a>
                          <span class="muted"> · ${relativeTime(existing[0].created_at)}</span>
                        </p>`
                      : ''}
                    <form method="post" action="/app/sites/${site.id}/evidence">
                      <input type="hidden" name="_csrf" value="${ctx.csrf}">
                      <input type="hidden" name="kind" value="${kind}">
                      <button type="submit" class="btn btn-secondary btn-sm" ${!latestScan && kind !== 'remediation' ? raw('disabled') : ''}>
                        ${existing.length ? 'Regenerate' : 'Generate'}
                      </button>
                    </form>
                  </div>`;
              })}
            </div>`}
      </div>

      <div class="card" style="margin-top:1.5rem">
        <h2 style="font-size:1.1rem">Automatic scanning</h2>
        <p class="small muted">
          Scheduled scans are what turn this from a report into monitoring. We only email when
          something actually changes.
        </p>
        <form method="post" action="/app/sites/${site.id}/schedule" class="row" style="align-items:flex-end">
          <input type="hidden" name="_csrf" value="${ctx.csrf}">
          <div>
            <label for="frequency" class="small" style="display:block;font-weight:600">Frequency</label>
            <select id="frequency" name="frequency" style="width:auto">
              ${allFrequencies.map((f) => {
                const allowed = frequencies.some((a) => a.id === f.id);
                return html`
                  <option value="${f.id}"
                          ${f.id === site.scan_frequency ? raw(' selected') : raw('')}
                          ${allowed ? raw('') : raw(' disabled')}>
                    ${f.label}${allowed ? '' : ` — ${f.minPlan} plan`}
                  </option>`;
              })}
            </select>
          </div>
          <div>
            <label class="small" style="display:block;font-weight:600" for="notify">Email the team</label>
            <input type="checkbox" id="notify" name="notify" ${site.notify_emails ? raw('checked') : ''}
                   style="width:auto;margin-top:.6rem">
          </div>
          <button type="submit" class="btn btn-secondary">Save schedule</button>
        </form>
        ${site.next_scan_at && site.scan_frequency !== 'manual'
          ? html`<p class="small muted" style="margin-top:.6rem">Next scan ${relativeTime(site.next_scan_at)}.</p>`
          : ''}
      </div>

      <div class="card" style="margin-top:1.5rem">
        <h2 style="font-size:1.1rem">Site settings</h2>
        <form method="post" action="/app/sites/${site.id}/delete"
              onsubmit="return confirm('Delete this site and all of its scan history? This cannot be undone.')">
          <input type="hidden" name="_csrf" value="${ctx.csrf}">
          <p class="small muted">Deleting removes all scans, findings and evidence for this site.</p>
          <button type="submit" class="btn btn-danger btn-sm">Delete site</button>
        </form>
      </div>
    </div>
  `;

  return page({ title: site.name, body, ctx });
}

/* ------------------------------------------------------------------ *
 * Scan report
 * ------------------------------------------------------------------ */

export function scanReportPage(ctx, { site, scan, groups, pages, notice = null, filter = null, serviceCallout = '' }) {
  const totals = scan.totals_json ? JSON.parse(scan.totals_json) : {};
  const coverageInfo = scan.coverage_json ? JSON.parse(scan.coverage_json) : null;

  // Teams work one tier at a time: confirmed failures first, recommendations last.
  const tierCounts = {
    all: groups.reduce((n, g) => n + g.items.length, 0),
    definite: groups.filter((g) => g.confidence === 'definite').reduce((n, g) => n + g.items.length, 0),
    review: groups.filter((g) => g.confidence === 'review').reduce((n, g) => n + g.items.length, 0),
    advisory: groups.filter((g) => g.confidence === 'advisory').reduce((n, g) => n + g.items.length, 0),
  };
  const visibleGroups = filter ? groups.filter((g) => g.confidence === filter) : groups;

  const filterLink = (value, label, count) => html`
    <a href="/app/scans/${scan.id}${value ? `?tier=${value}` : ''}"
       class="chip${(filter || '') === (value || '') ? ' chip-active' : ''}">
      ${label} <span class="chip-count">${String(count)}</span>
    </a>`;

  const body = html`
    <div class="wrap" style="padding-top:2rem">
      <p class="small muted"><a href="/app/sites/${site.id}">← ${site.name}</a></p>
      ${notice ? alert('success', notice) : ''}

      <div class="row-between" style="margin-bottom:1.5rem">
        <div class="row" style="gap:1.25rem">
          ${scoreRing(scan.score)}
          <div>
            <h1 style="margin-bottom:.2rem;font-size:1.6rem">Scan report</h1>
            <p class="muted tight small">
              ${String(scan.pages_scanned)} pages · ${relativeTime(scan.finished_at)} · ${scan.trigger}
            </p>
            <div class="row" style="margin-top:.5rem">
              <span class="badge badge-critical">${String(totals.critical || 0)} critical</span>
              <span class="badge badge-serious">${String(totals.serious || 0)} serious</span>
              <span class="badge badge-moderate">${String(totals.moderate || 0)} moderate</span>
              <span class="badge badge-minor">${String(totals.minor || 0)} minor</span>
            </div>
          </div>
        </div>
        <a class="btn btn-primary" href="/app/scans/${scan.id}/fixes">Get the fix plan</a>
      </div>

      <div class="tabs">
        <a href="/app/scans/${scan.id}" aria-current="page">Issues (${String(totals.total || 0)})</a>
        <a href="/app/scans/${scan.id}/fixes">Fix plan</a>
        <a href="/app/scans/${scan.id}/pages">Pages (${String(pages.length)})</a>
      </div>

      ${coverageInfo && !coverageInfo.complete ? alert('warn', coverageInfo.note) : ''}
      ${serviceCallout}

      ${groups.length
        ? html`
          <div class="row" style="margin-bottom:1rem">
            ${filterLink(null, 'Everything', tierCounts.all)}
            ${filterLink('definite', 'Confirmed failures', tierCounts.definite)}
            ${filterLink('review', 'Needs review', tierCounts.review)}
            ${filterLink('advisory', 'Recommendations', tierCounts.advisory)}
          </div>
          <p class="small muted">
            <strong>Confirmed</strong> failures are machine-verifiable. <strong>Needs review</strong>
            items require a human decision. <strong>Recommendations</strong> are best-practice
            improvements that do not affect your score and never appear in a conformance document.
          </p>`
        : ''}

      ${visibleGroups.length === 0
        ? html`
          <div class="empty">
            <h3>${filter ? 'Nothing in this category' : 'No issues detected'}</h3>
            <p style="max-width:48ch;margin-inline:auto">
              No automated failures were found. Remember that ${String(coverage.none)} of the
              ${String(coverage.total)} WCAG 2.1 A/AA criteria cannot be tested by software and still
              require human review.
            </p>
          </div>`
        : html`
          ${visibleGroups.map((group) => html`
            <details class="finding">
              <summary>
                ${impactBadge(group.impact)}
                ${group.title}
                <span class="muted small">${String(group.items.length)} ${group.items.length === 1 ? 'instance' : 'instances'}</span>
                ${confidenceBadge(group.confidence)}
              </summary>
              <div class="finding-body">
                <p class="small">${group.why}</p>
                <p class="small muted">
                  WCAG ${group.wcag.join(', ')} (Level ${group.level})${group.section508.length ? ` · Section 508: ${group.section508.join(', ')}` : ''}
                </p>

                ${group.items.slice(0, 25).map((item) => html`
                  <div class="occurrence">
                    <div>${item.message}</div>
                    <code>${item.snippet}</code>
                    <div class="small muted" style="margin-top:.35rem">
                      <a href="${item.page_url}" rel="noopener noreferrer nofollow">${item.page_url}</a>
                      ${item.line ? html` · line ${String(item.line)}` : ''}
                      · <span class="mono">${item.selector}</span>
                    </div>
                    ${item.fix?.guidance
                      ? html`<p class="small" style="margin:.4rem 0 0"><strong>How to fix:</strong> ${item.fix.guidance}</p>`
                      : ''}
                    <form method="post" action="/app/findings/${item.signature}/status" style="margin-top:.5rem">
                      <input type="hidden" name="_csrf" value="${ctx.csrf}">
                      <input type="hidden" name="siteId" value="${site.id}">
                      <input type="hidden" name="scanId" value="${scan.id}">
                      <div class="row" style="gap:.4rem">
                        <label for="status-${item.signature}" class="visually-hidden">Status for this issue</label>
                        <select id="status-${item.signature}" name="status" class="small" style="width:auto;padding:.25rem .5rem">
                          <option value="open" ${item.ledger_status === 'open' ? raw('selected') : ''}>Open</option>
                          <option value="in_progress" ${item.ledger_status === 'in_progress' ? raw('selected') : ''}>In progress</option>
                          <option value="wontfix" ${item.ledger_status === 'wontfix' ? raw('selected') : ''}>Accepted risk</option>
                          <option value="false_positive" ${item.ledger_status === 'false_positive' ? raw('selected') : ''}>False positive</option>
                        </select>
                        <button type="submit" class="btn btn-ghost btn-sm">Update</button>
                      </div>
                    </form>
                  </div>
                `)}
                ${group.items.length > 25
                  ? html`<p class="small muted">Showing 25 of ${String(group.items.length)} instances.</p>`
                  : ''}
              </div>
            </details>
          `)}
        `}
    </div>
  `;

  return page({ title: `Scan report — ${site.name}`, body, ctx });
}

export function scanPagesPage(ctx, { site, scan, pages }) {
  const body = html`
    <div class="wrap" style="padding-top:2rem">
      <p class="small muted"><a href="/app/scans/${scan.id}">← Scan report</a></p>
      <h1 style="font-size:1.6rem">Pages scanned</h1>
      <div class="tabs">
        <a href="/app/scans/${scan.id}">Issues</a>
        <a href="/app/scans/${scan.id}/fixes">Fix plan</a>
        <a href="/app/scans/${scan.id}/pages" aria-current="page">Pages (${String(pages.length)})</a>
      </div>
      <div class="card card-flush table-wrap">
        <table>
          <thead>
            <tr><th scope="col">URL</th><th scope="col">Title</th><th scope="col">Status</th><th scope="col">Issues</th><th scope="col">Rendering</th></tr>
          </thead>
          <tbody>
            ${pages.map((p) => html`
              <tr>
                <td style="max-width:280px;overflow-wrap:anywhere"><a href="${p.url}" rel="noopener noreferrer nofollow">${p.url}</a></td>
                <td>${p.title || '—'}</td>
                <td>${p.error ? html`<span class="badge badge-critical">error</span>` : String(p.status_code)}</td>
                <td>${String(p.issue_count ?? 0)}</td>
                <td>${p.render_mode === 'static'
                  ? html`<span class="badge badge-success">full</span>`
                  : html`<span class="badge badge-moderate" title="${p.coverage_note || ''}">partial</span>`}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    </div>
  `;
  return page({ title: 'Pages scanned', body, ctx });
}

/* ------------------------------------------------------------------ *
 * Fix plan — the core value moment
 * ------------------------------------------------------------------ */

export function fixPlanPage(ctx, { site, scan, plans, locked = false }) {
  if (locked) {
    const body = html`
      <div class="wrap" style="padding-top:2rem">
        <p class="small muted"><a href="/app/scans/${scan.id}">← Scan report</a></p>
        <div class="card center" style="padding:3rem 1.5rem">
          <h1>Code fixes are on paid plans</h1>
          <p class="muted" style="max-width:52ch;margin-inline:auto">
            Curbcut generates ready-to-merge patches for the mechanical failures on this site, plus
            specific guidance for everything that needs a person. Upgrade to unlock them.
          </p>
          <a class="btn btn-primary btn-lg" href="/app/settings/billing">See plans</a>
        </div>
      </div>`;
    return page({ title: 'Fix plan', body, ctx });
  }

  const totalAutomatic = plans.reduce((sum, p) => sum + p.counts.automatic, 0);
  const totalManual = plans.reduce((sum, p) => sum + p.counts.manual, 0);

  const body = html`
    <div class="wrap" style="padding-top:2rem">
      <p class="small muted"><a href="/app/sites/${site.id}">← ${site.name}</a></p>
      <h1 style="font-size:1.6rem">Fix plan</h1>

      <div class="tabs">
        <a href="/app/scans/${scan.id}">Issues</a>
        <a href="/app/scans/${scan.id}/fixes" aria-current="page">Fix plan</a>
        <a href="/app/scans/${scan.id}/pages">Pages</a>
      </div>

      <div class="grid grid-2" style="margin-bottom:1.5rem">
        <div class="card">
          <p class="stat-value" style="color:var(--success)">${String(totalAutomatic)}</p>
          <p class="stat-label">Fixes we generated. Review the diff and apply.</p>
        </div>
        <div class="card">
          <p class="stat-value">${String(totalManual)}</p>
          <p class="stat-label">Issues needing a human decision, with specific guidance.</p>
        </div>
      </div>

      <div class="alert alert-info">
        <p><strong>How to use this.</strong> The diffs below apply to the HTML we fetched. If your pages come
        from templates or components, apply the same change at the source. Every patch is either additive
        (adding an attribute) or restrictive (removing something that blocks users) — none of them change
        what your page does.</p>
      </div>

      ${plans.length === 0
        ? html`<div class="empty"><h3>Nothing to patch</h3><p>No mechanically fixable issues were found in this scan.</p></div>`
        : plans.map((plan) => html`
          <div class="card" style="margin-bottom:1.5rem">
            <div class="row-between" style="margin-bottom:.8rem">
              <h2 style="font-size:1.05rem;margin:0;overflow-wrap:anywhere">${plan.url}</h2>
              <span class="badge badge-accent">${String(plan.counts.automatic)} auto · ${String(plan.counts.manual)} manual</span>
            </div>

            ${plan.diff
              ? html`
                <h3 style="font-size:.95rem">Patch</h3>
                ${renderDiff(plan.diff)}
                <p style="margin-top:.6rem">
                  <a class="btn btn-secondary btn-sm" href="/app/scans/${scan.id}/patch?page=${encodeURIComponent(plan.url)}">
                    Download .patch
                  </a>
                </p>`
              : html`<p class="muted small">No mechanical fixes on this page.</p>`}

            ${plan.cssSnippet
              ? html`
                <h3 style="font-size:.95rem;margin-top:1.2rem">Contrast adjustments</h3>
                <p class="small muted">Suggested colors meet the required ratio against the detected background. Check them against your brand palette.</p>
                <pre><code>${plan.cssSnippet}</code></pre>`
              : ''}

            ${plan.manual.length
              ? html`
                <h3 style="font-size:.95rem;margin-top:1.2rem">Needs a person (${String(plan.manual.length)})</h3>
                ${plan.manual.slice(0, 12).map((item) => html`
                  <div class="occurrence">
                    <div class="row" style="gap:.5rem">
                      ${impactBadge(item.finding.impact)}
                      <strong class="small">${item.finding.title || item.finding.rule_id}</strong>
                    </div>
                    <div class="small" style="margin-top:.25rem">${item.finding.message}</div>
                    <code>${item.finding.snippet}</code>
                    <p class="small" style="margin:.4rem 0 0"><strong>What to do:</strong> ${item.guidance}</p>
                  </div>
                `)}
                ${plan.manual.length > 12 ? html`<p class="small muted">…and ${String(plan.manual.length - 12)} more.</p>` : ''}`
              : ''}
          </div>
        `)}
    </div>
  `;

  return page({ title: 'Fix plan', body, ctx });
}

/* ------------------------------------------------------------------ *
 * Evidence document viewer
 * ------------------------------------------------------------------ */

export function evidenceDocPage(ctx, { doc, site }) {
  const meta = DOCUMENT_KINDS[doc.kind];
  const body = html`
    <div class="wrap" style="padding-top:2rem">
      <p class="small muted no-print"><a href="/app/sites/${site.id}">← ${site.name}</a></p>
      <div class="row-between no-print" style="margin-bottom:1.5rem">
        <div>
          <h1 style="font-size:1.5rem;margin-bottom:.2rem">${meta.name}</h1>
          <p class="small muted tight">
            Version ${String(doc.version)} · generated ${relativeTime(doc.created_at)} ·
            hash <code>${doc.content_hash}</code>
          </p>
        </div>
        <div class="row">
          <a class="btn btn-secondary btn-sm" href="/app/evidence/${doc.id}/download">Download HTML</a>
          <button type="button" class="btn btn-secondary btn-sm" onclick="window.print()">Print / PDF</button>
        </div>
      </div>
      <div class="card doc-content">
        ${raw(doc.content)}
      </div>
    </div>
  `;
  return page({ title: meta.name, body, ctx });
}

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

export function settingsPage(ctx, { org, members, apiKeys, invitations = [], newKey = null, notice = null, error = null }) {
  const plan = getPlan(org.plan);

  const body = html`
    <div class="wrap" style="padding-top:2rem">
      <h1>Settings</h1>
      <div class="tabs">
        <a href="/app/settings" aria-current="page">General</a>
        <a href="/app/settings/billing">Billing</a>
      </div>

      ${notice ? alert('success', notice) : ''}
      ${error ? alert('error', error) : ''}

      <div class="card" style="margin-bottom:1.5rem">
        <h2 style="font-size:1.1rem">Organization</h2>
        <form method="post" action="/app/settings">
          <input type="hidden" name="_csrf" value="${ctx.csrf}">
          <div class="field">
            <label for="org-name">Team name</label>
            <input type="text" id="org-name" name="name" value="${org.name}" required>
          </div>
          <div class="field">
            <label for="org-legal">Legal entity name</label>
            <input type="text" id="org-legal" name="legalName" value="${org.legal_name || ''}"
                   placeholder="Acme Corporation Ltd">
            <p class="hint">Used on your accessibility statement and VPAT. Leave blank to use the team name.</p>
          </div>
          <div class="field">
            <label for="org-contact">Accessibility contact email</label>
            <input type="email" id="org-contact" name="contactEmail" value="${org.contact_email || ''}">
            <p class="hint">Published in your accessibility statement so users can report barriers.</p>
          </div>
          <button type="submit" class="btn btn-primary">Save</button>
        </form>
      </div>

      <div class="card" style="margin-bottom:1.5rem">
        <h2 style="font-size:1.1rem">Team</h2>
        <p class="small muted">
          ${String(members.length + invitations.length)} of ${String(plan.limits.seats)} seats used
          ${invitations.length ? html`· ${String(invitations.length)} pending` : ''}
        </p>
        <div class="table-wrap">
          <table>
            <thead><tr><th scope="col">Email</th><th scope="col">Name</th><th scope="col">Role</th><th scope="col">Status</th><th scope="col"></th></tr></thead>
            <tbody>
              ${members.map((m) => html`
                <tr>
                  <td>${m.email}</td><td>${m.name || '—'}</td><td>${m.role}</td>
                  <td><span class="badge badge-success">active</span></td><td></td>
                </tr>`)}
              ${invitations.map((i) => html`
                <tr>
                  <td>${i.email}</td><td class="muted">—</td><td>${i.role}</td>
                  <td><span class="badge badge-outline">invited</span></td>
                  <td>
                    <form method="post" action="/app/settings/invite/revoke">
                      <input type="hidden" name="_csrf" value="${ctx.csrf}">
                      <input type="hidden" name="email" value="${i.email}">
                      <button type="submit" class="btn btn-ghost btn-sm">Revoke</button>
                    </form>
                  </td>
                </tr>`)}
            </tbody>
          </table>
        </div>

        <form method="post" action="/app/settings/invite" class="row" style="margin-top:1rem;align-items:flex-end">
          <input type="hidden" name="_csrf" value="${ctx.csrf}">
          <div style="flex:1 1 220px">
            <label for="invite-email" class="small" style="display:block;font-weight:600">Invite a teammate</label>
            <input type="email" id="invite-email" name="email" required placeholder="colleague@company.com" autocomplete="off">
          </div>
          <div>
            <label for="invite-role" class="small" style="display:block;font-weight:600">Role</label>
            <select id="invite-role" name="role" style="width:auto">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <button type="submit" class="btn btn-secondary">Send invitation</button>
        </form>
      </div>

      <div class="card">
        <h2 style="font-size:1.1rem">API keys</h2>
        ${!plan.features.api
          ? html`<p class="muted">API access is available on Growth and above.
              <a href="/app/settings/billing">See plans</a></p>`
          : html`
            ${newKey
              ? html`
                <div class="alert alert-success">
                  <p><strong>Copy this key now — it won't be shown again.</strong></p>
                  <p><code style="overflow-wrap:anywhere">${newKey}</code></p>
                </div>`
              : ''}
            ${apiKeys.length
              ? html`
                <div class="table-wrap">
                  <table>
                    <thead><tr><th scope="col">Name</th><th scope="col">Key</th><th scope="col">Last used</th><th scope="col"></th></tr></thead>
                    <tbody>
                      ${apiKeys.map((key) => html`
                        <tr>
                          <td>${key.name}</td>
                          <td><code>${key.prefix}…</code></td>
                          <td>${relativeTime(key.last_used_at)}</td>
                          <td>
                            <form method="post" action="/app/settings/api-keys/${key.id}/revoke">
                              <input type="hidden" name="_csrf" value="${ctx.csrf}">
                              <button type="submit" class="btn btn-ghost btn-sm">Revoke</button>
                            </form>
                          </td>
                        </tr>
                      `)}
                    </tbody>
                  </table>
                </div>`
              : html`<p class="muted small">No API keys yet.</p>`}
            <form method="post" action="/app/settings/api-keys" class="row" style="margin-top:1rem">
              <input type="hidden" name="_csrf" value="${ctx.csrf}">
              <label for="key-name" class="visually-hidden">Key name</label>
              <input type="text" id="key-name" name="name" placeholder="CI pipeline" style="width:auto;flex:1 1 200px">
              <button type="submit" class="btn btn-secondary">Create key</button>
            </form>
            <p class="small muted" style="margin-top:.5rem">See the <a href="/docs/api">API reference</a>.</p>`}
      </div>
    </div>
  `;

  return page({ title: 'Settings', body, ctx });
}

export function billingPage(ctx, { org, notice = null, error = null, portalUrl = null }) {
  const currentPlan = getPlan(org.plan);
  const trial = trialStatus(org);
  const mode = billingMode();

  const body = html`
    <div class="wrap" style="padding-top:2rem">
      <h1>Settings</h1>
      <div class="tabs">
        <a href="/app/settings">General</a>
        <a href="/app/settings/billing" aria-current="page">Billing</a>
      </div>

      ${notice ? alert('success', notice) : ''}
      ${error ? alert('error', error) : ''}
      ${mode === 'local'
        ? alert('info', 'Stripe is not configured, so plan changes apply immediately without payment. Set STRIPE_SECRET_KEY to enable real checkout.')
        : ''}

      <div class="card" style="margin-bottom:1.5rem">
        <div class="row-between">
          <div>
            <h2 style="font-size:1.1rem;margin-bottom:.2rem">Current plan: ${currentPlan.name}</h2>
            <p class="muted tight small">
              ${trial && !trial.expired
                ? `Trial ends in ${trial.days} days.`
                : `${currentPlan.priceLabel} ${currentPlan.cadence}`}
              · Billing status: ${org.billing_status}
            </p>
          </div>
          ${portalUrl ? html`<a class="btn btn-secondary" href="${portalUrl}">Manage billing</a>` : ''}
        </div>
      </div>

      <div class="price-grid">
        ${PLAN_ORDER.map((planId) => {
          const plan = PLANS[planId];
          const isCurrent = planId === org.plan;
          return html`
            <div class="card price-card ${plan.popular ? 'popular' : ''}">
              ${plan.popular ? html`<span class="popular-flag">Most popular</span>` : ''}
              <h2 style="font-size:1.1rem">${plan.name}</h2>
              <p class="price-tag">${plan.priceLabel}</p>
              <p class="small muted">${plan.tagline}</p>
              <ul>${plan.highlights.map((item) => html`<li>${item}</li>`)}</ul>
              ${isCurrent
                ? html`<span class="btn btn-secondary" aria-disabled="true">Current plan</span>`
                : html`
                  <form method="post" action="/app/settings/billing">
                    <input type="hidden" name="_csrf" value="${ctx.csrf}">
                    <input type="hidden" name="plan" value="${plan.id}">
                    <button type="submit" class="btn ${plan.popular ? 'btn-primary' : 'btn-secondary'}" style="width:100%">
                      ${plan.price > currentPlan.price ? 'Upgrade' : 'Change'} to ${plan.name}
                    </button>
                  </form>`}
            </div>`;
        })}
      </div>
    </div>
  `;

  return page({ title: 'Billing', body, ctx });
}
