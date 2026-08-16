/**
 * Client script for the live scan view. Served at /assets/scan.js.
 *
 * Kept as an external file (never inline) so the Content-Security-Policy can
 * stay at script-src 'self'. The page is fully usable without this file: the
 * server renders a snapshot and a meta-refresh fallback drives it forward.
 */
export const SCAN_CLIENT = `
(function () {
  'use strict';

  var root = document.getElementById('scan-progress');
  if (!root || typeof EventSource === 'undefined') return;

  var scanId = root.getAttribute('data-scan-id');
  if (!scanId) return;

  // JavaScript is available, so drop the no-JS polling refresh.
  var fallback = document.getElementById('progress-refresh');
  if (fallback && fallback.parentNode) fallback.parentNode.removeChild(fallback);

  var logEl = document.getElementById('activity-log');
  var statusEl = document.getElementById('progress-status');
  var barEl = document.getElementById('progress-bar');
  var currentEl = document.getElementById('current-url');
  var counts = {
    pages: document.getElementById('count-pages'),
    definite: document.getElementById('count-definite'),
    review: document.getElementById('count-review'),
    advisory: document.getElementById('count-advisory')
  };

  var state = { pages: 0, planned: 0, definite: 0, review: 0, advisory: 0 };
  var MAX_ROWS = 300;

  function text(value) {
    return document.createTextNode(String(value));
  }

  function row(kind, label, detail, meta) {
    var li = document.createElement('li');
    li.className = 'log-row log-' + kind;

    var tag = document.createElement('span');
    tag.className = 'log-tag';
    tag.appendChild(text(label));
    li.appendChild(tag);

    var body = document.createElement('span');
    body.className = 'log-body';
    body.appendChild(text(detail));
    li.appendChild(body);

    if (meta) {
      var m = document.createElement('span');
      m.className = 'log-meta';
      m.appendChild(text(meta));
      li.appendChild(m);
    }

    logEl.appendChild(li);
    while (logEl.childNodes.length > MAX_ROWS) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function shortUrl(value) {
    try {
      var u = new URL(value);
      return u.pathname + (u.search || '');
    } catch (e) {
      return value;
    }
  }

  function render() {
    if (counts.pages) counts.pages.textContent = String(state.pages);
    if (counts.definite) counts.definite.textContent = String(state.definite);
    if (counts.review) counts.review.textContent = String(state.review);
    if (counts.advisory) counts.advisory.textContent = String(state.advisory);

    if (barEl && state.planned > 0) {
      var pct = Math.min(100, Math.round((state.pages / state.planned) * 100));
      barEl.style.width = pct + '%';
      barEl.parentNode.setAttribute('aria-valuenow', String(pct));
    }
  }

  var source = new EventSource('/app/scans/' + encodeURIComponent(scanId) + '/stream');

  source.onmessage = function (message) {
    var event;
    try { event = JSON.parse(message.data); } catch (e) { return; }

    switch (event.type) {
      case 'phase':
        if (statusEl) statusEl.textContent = event.message || event.phase;
        row('phase', 'phase', event.message || event.phase);
        break;

      case 'plan':
        state.planned = event.pages;
        row('phase', 'plan', 'Budget: up to ' + event.pages + ' pages');
        break;

      case 'fetch':
        if (currentEl) currentEl.textContent = shortUrl(event.url);
        row('fetch', 'fetch', shortUrl(event.url));
        break;

      case 'analyze':
        row('analyze', 'parse', shortUrl(event.url), (event.bytes / 1024).toFixed(0) + ' KB');
        break;

      case 'page':
        state.pages = event.index;
        state.definite += event.definite || 0;
        state.review += event.review || 0;
        state.advisory += event.advisory || 0;
        row(
          event.definite > 0 ? 'issue' : 'ok',
          'done',
          shortUrl(event.url) + ' — score ' + event.score + ', ' + event.findings + ' finding' + (event.findings === 1 ? '' : 's'),
          event.elements + ' elements'
        );
        if (event.top) {
          for (var i = 0; i < event.top.length; i++) {
            row('detail', event.top[i].impact, event.top[i].message);
          }
        }
        if (event.coverage && event.coverage !== 'static') {
          row('warn', 'partial', 'JavaScript-rendered content on this page was not fully covered');
        }
        render();
        break;

      case 'discovered':
        row('discover', 'found', event.count + ' new link' + (event.count === 1 ? '' : 's') + ' (' + event.queued + ' queued)');
        break;

      case 'skip':
        row('skip', 'skip', shortUrl(event.url) + ' — ' + event.reason);
        break;

      case 'error':
        row('warn', 'error', shortUrl(event.url || '') + ' — ' + (event.message || 'failed'));
        break;

      case 'end':
        if (event.status === 'complete') {
          if (statusEl) statusEl.textContent = 'Scan complete';
          row('done', 'complete', 'Scanned ' + event.pages + ' pages, score ' + event.score);
          if (event.reportUrl) window.location.href = event.reportUrl;
        } else {
          if (statusEl) statusEl.textContent = 'Scan failed';
          row('warn', 'failed', event.error || 'The scan could not be completed.');
        }
        source.close();
        break;

      default:
        break;
    }
  };

  source.onerror = function () {
    // The stream ends when the scan does; only surface a genuine drop.
    if (source.readyState === EventSource.CLOSED && statusEl) {
      statusEl.textContent = 'Connection closed — reload to see the result.';
    }
  };
})();
`.trim();

export default SCAN_CLIENT;
