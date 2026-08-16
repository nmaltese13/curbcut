import { html, raw } from '../html.js';
import { page, alert } from '../layout.js';

/**
 * Live scan view.
 *
 * Server-rendered from a snapshot first, then driven by Server-Sent Events. With
 * JavaScript unavailable the meta-refresh keeps it moving, so the page works
 * either way — which matters more than usual for an accessibility product.
 */
export function scanProgressPage(ctx, { site, scan, state }) {
  const planned = state.pagesPlanned || site.max_pages || 25;
  const percent = planned ? Math.min(100, Math.round((state.pagesDone / planned) * 100)) : 0;
  const finished = state.ended || scan.status === 'complete' || scan.status === 'failed';

  const logRow = (event) => {
    switch (event.type) {
      case 'phase': return { kind: 'phase', tag: 'phase', body: event.message || event.phase };
      case 'plan': return { kind: 'phase', tag: 'plan', body: `Budget: up to ${event.pages} pages` };
      case 'fetch': return { kind: 'fetch', tag: 'fetch', body: shortUrl(event.url) };
      case 'analyze': return { kind: 'analyze', tag: 'parse', body: shortUrl(event.url) };
      case 'page': return {
        kind: event.definite > 0 ? 'issue' : 'ok',
        tag: 'done',
        body: `${shortUrl(event.url)} — score ${event.score}, ${event.findings} finding${event.findings === 1 ? '' : 's'}`,
        meta: `${event.elements} elements`,
      };
      case 'discovered': return { kind: 'discover', tag: 'found', body: `${event.count} new links (${event.queued} queued)` };
      case 'skip': return { kind: 'skip', tag: 'skip', body: `${shortUrl(event.url)} — ${event.reason}` };
      case 'error': return { kind: 'warn', tag: 'error', body: `${shortUrl(event.url || '')} — ${event.message || 'failed'}` };
      case 'end': return {
        kind: event.status === 'complete' ? 'done' : 'warn',
        tag: event.status === 'complete' ? 'complete' : 'failed',
        body: event.status === 'complete' ? `Scanned ${event.pages} pages, score ${event.score}` : (event.error || 'Scan failed'),
      };
      default: return null;
    }
  };

  const rows = state.log.map(logRow).filter(Boolean);

  const body = html`
    <div class="wrap" style="padding-top:2rem">
      <p class="small muted"><a href="/app/sites/${site.id}">← ${site.name}</a></p>

      <div id="scan-progress" data-scan-id="${scan.id}">
        <div class="row-between" style="margin-bottom:1.25rem">
          <div>
            <h1 style="font-size:1.6rem;margin-bottom:.25rem">
              ${finished ? 'Scan finished' : 'Scanning'} ${site.name}
            </h1>
            <p class="muted tight small">
              <span id="progress-status" role="status">${state.phase === 'complete' ? 'Scan complete' : phaseLabel(state.phase)}</span>
              · <span class="mono" id="current-url">${state.currentUrl ? shortUrl(state.currentUrl) : '—'}</span>
            </p>
          </div>
          ${finished
            ? html`<a class="btn btn-primary" href="/app/scans/${scan.id}">View the report</a>`
            : html`<span class="badge badge-accent">Live</span>`}
        </div>

        <div class="progress" style="margin-bottom:1.5rem"
             role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${String(percent)}"
             aria-label="Scan progress">
          <span class="progress-bar" id="progress-bar" style="width:${String(percent)}%"></span>
        </div>

        <div class="grid grid-4" style="margin-bottom:1.5rem">
          <div class="card stat">
            <p class="stat-value" id="count-pages">${String(state.pagesDone)}</p>
            <p class="stat-label">Pages scanned</p>
          </div>
          <div class="card stat">
            <p class="stat-value" id="count-definite" style="color:var(--critical)">${String(state.findings.definite)}</p>
            <p class="stat-label">Confirmed failures</p>
          </div>
          <div class="card stat">
            <p class="stat-value" id="count-review" style="color:var(--serious)">${String(state.findings.review)}</p>
            <p class="stat-label">Need review</p>
          </div>
          <div class="card stat">
            <p class="stat-value" id="count-advisory" class="muted">${String(state.findings.advisory)}</p>
            <p class="stat-label">Recommendations</p>
          </div>
        </div>

        <div class="card card-flush">
          <div class="card-header">
            <h2 style="font-size:1rem">Activity</h2>
            <span class="small muted">Every page fetched, parsed and checked</span>
          </div>
          <ul class="log" id="activity-log">
            ${rows.length
              ? rows.map((r) => html`
                <li class="log-row log-${r.kind}">
                  <span class="log-tag">${r.tag}</span>
                  <span class="log-body">${r.body}</span>
                  ${r.meta ? html`<span class="log-meta">${r.meta}</span>` : ''}
                </li>`)
              : html`<li class="log-row log-phase"><span class="log-tag">wait</span><span class="log-body">Starting up…</span></li>`}
          </ul>
        </div>

        ${finished && scan.status === 'failed'
          ? alert('error', scan.error || 'The scan could not be completed.')
          : ''}
      </div>
    </div>
  `;

  // Without JavaScript this keeps the page advancing; the client script removes it.
  const head = finished
    ? ''
    : '<meta http-equiv="refresh" content="4" id="progress-refresh">';

  return page({
    title: `Scanning ${site.name}`,
    body,
    ctx,
    head: `${head}<script src="/assets/scan.js" defer></script>`,
  });
}

function phaseLabel(phase) {
  const labels = {
    starting: 'Starting up',
    robots: 'Reading robots.txt',
    sitemap: 'Discovering pages',
    'crawl-complete': 'Finishing up',
    reconciling: 'Comparing against previous scans',
    complete: 'Scan complete',
  };
  return labels[phase] || 'Working';
}

function shortUrl(value) {
  try {
    const parsed = new URL(value);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return value;
  }
}
