import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { analyzePage } from '../src/scan/engine.js';
import { renderStatic, renderWithBrowser, browserAvailable, closeBrowser } from '../src/scan/render.js';

/**
 * Proves what headless rendering buys us. Each case is something static
 * analysis provably cannot determine, and that a real browser resolves exactly.
 *
 * Skips cleanly when Playwright is not installed, because the product must not
 * require it.
 */

let server;
let base;
let available = false;

// Content injected by JavaScript: invisible to a plain fetch.
const SPA_PAGE = `<!DOCTYPE html>
<html lang="en"><head><title>App</title></head>
<body><div id="root"></div>
<script>
  document.getElementById('root').innerHTML =
    '<main><h1>Dashboard</h1><img src="/chart.png"><button></button>' +
    '<input type="text" name="q"></main>';
</script>
</body></html>`;

// Colors that only exist after the cascade resolves a custom property.
const VARIABLE_COLOR_PAGE = `<!DOCTYPE html>
<html lang="en"><head><title>Brand</title><style>
  :root { --muted: #a3a3a3; --page: #ffffff; }
  body { background: var(--page); color: #222; }
  main { padding: 20px; }
  .muted { color: var(--muted); font-size: 14px; }
  .tiny { width: 16px; height: 16px; padding: 0; border: 0; }
</style></head>
<body><main>
  <h1>Brand page</h1>
  <p class="muted">This grey is only resolvable after the cascade runs.</p>
  <button class="tiny" aria-label="Close">x</button>
</main></body></html>`;

before(async () => {
  server = http.createServer((req, res) => {
    const path = req.url.split('?')[0];
    if (path === '/robots.txt') { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(path === '/vars' ? VARIABLE_COLOR_PAGE : SPA_PAGE);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  available = await browserAvailable();
});

after(async () => {
  await closeBrowser();
  server?.close();
});

describe('static analysis limits', () => {
  test('a JavaScript-rendered page is reported as incompletely covered', async () => {
    const rendered = await renderStatic(`${base}/app`);
    const result = analyzePage(rendered.html, { url: rendered.url, css: rendered.css, renderMode: 'static' });

    assert.equal(result.coverage.complete, false);
    assert.match(result.coverage.note, /JavaScript/i);
    // The real violations are invisible to a plain fetch. Saying "0 problems"
    // here would be the dishonest answer, which is why coverage is flagged.
    assert.equal(result.findings.filter((f) => f.ruleId === 'img-alt').length, 0);
  });

  test('a color behind a CSS variable is skipped rather than guessed', async () => {
    const rendered = await renderStatic(`${base}/vars`);
    const result = analyzePage(rendered.html, { url: rendered.url, css: rendered.css, renderMode: 'static' });
    assert.equal(result.findings.filter((f) => f.ruleId === 'color-contrast').length, 0);
  });
});

describe('browser rendering', { skip: !process.env.CI_FORCE_BROWSER && false }, () => {
  test('finds violations that only exist after JavaScript runs', async (t) => {
    if (!available) return t.skip('playwright not installed');

    const rendered = await renderWithBrowser(`${base}/app`);
    assert.equal(rendered.mode, 'browser');

    const result = analyzePage(rendered.html, {
      url: rendered.url,
      computed: rendered.computed,
      layout: rendered.layout,
      renderMode: 'browser',
    });

    const ids = new Set(result.findings.map((f) => f.ruleId));
    assert.ok(ids.has('img-alt'), 'the injected image should now be visible');
    assert.ok(ids.has('button-name'), 'the injected button should now be visible');
    assert.ok(ids.has('input-label'), 'the injected input should now be visible');

    // Having executed the page, coverage is no longer partial.
    assert.equal(result.coverage.complete, true);
    assert.equal(result.coverage.mode, 'browser');
  });

  test('measures contrast that static analysis cannot resolve', async (t) => {
    if (!available) return t.skip('playwright not installed');

    const rendered = await renderWithBrowser(`${base}/vars`);
    const result = analyzePage(rendered.html, {
      url: rendered.url,
      computed: rendered.computed,
      layout: rendered.layout,
      renderMode: 'browser',
    });

    const contrast = result.findings.filter((f) => f.ruleId === 'color-contrast');
    assert.ok(contrast.length >= 1, 'expected the variable-driven grey to be caught');
    assert.match(contrast[0].message, /measured in a real browser/);
    assert.ok(contrast[0].data.ratio < 4.5);
    assert.ok(contrast[0].data.suggestion, 'expected a concrete replacement color');
  });

  test('detects touch targets that are too small', async (t) => {
    if (!available) return t.skip('playwright not installed');

    const rendered = await renderWithBrowser(`${base}/vars`);
    const result = analyzePage(rendered.html, {
      url: rendered.url,
      computed: rendered.computed,
      layout: rendered.layout,
      renderMode: 'browser',
    });

    const target = result.findings.find((f) => f.ruleId === 'target-size-minimum');
    assert.ok(target, 'expected the 16x16 button to be flagged');
    assert.ok(target.data.width < 24 && target.data.height < 24);
  });

  test('computed selectors line up with the parsed document', async (t) => {
    if (!available) return t.skip('playwright not installed');

    const rendered = await renderWithBrowser(`${base}/vars`);
    // The join between browser measurements and our parse tree is the selector
    // string. If these ever drift, every measured rule silently stops firing.
    const result = analyzePage(rendered.html, {
      url: rendered.url, computed: rendered.computed, renderMode: 'browser',
    });
    assert.ok(result.stats.measured > 0, 'expected measurements to be collected');
    assert.ok(
      result.findings.some((f) => f.ruleId === 'color-contrast' || f.ruleId === 'target-size-minimum'),
      'expected at least one measured rule to match an element'
    );
  });
});
