import config from '../config.js';
import log from '../log.js';
import { safeFetch, assertPublicUrl, extractStylesheetUrls } from './crawler.js';

/**
 * Page rendering.
 *
 * Two modes:
 *
 *   static  — fetch the HTML the server returned. Always available, zero
 *             dependencies, and the mode that produces patches which map onto
 *             the customer's own templates.
 *
 *   browser — drive a real headless Chromium, let the page's JavaScript run, and
 *             read genuinely computed styles and geometry. This is the only way
 *             to evaluate a client-rendered application, and the only way to
 *             know a real color rather than inferring one from a stylesheet.
 *
 * Playwright is an optional dependency. If it is not installed the product works
 * exactly as before, so a deployment never needs a browser to be useful.
 */

let browserPromise = null;
let availability = null;

/** Is Playwright installed and launchable? Cached after the first check. */
export async function browserAvailable() {
  if (availability !== null) return availability;
  if (config.render.mode === 'static') {
    availability = false;
    return availability;
  }
  try {
    await import('playwright');
    availability = true;
  } catch {
    availability = false;
    log.info('playwright not installed; scanning in static mode', {
      hint: 'npm install playwright && npx playwright install chromium',
    });
  }
  return availability;
}

/** One browser per process, reused across pages and scans. */
async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const { chromium } = await import('playwright');
      return chromium.launch({
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
      });
    })().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  return browserPromise;
}

export async function closeBrowser() {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch {
    /* already gone */
  }
  browserPromise = null;
}

/**
 * Runs inside the page.
 *
 * The selector algorithm here must stay identical to `cssPath` in lib/html.js,
 * because that string is the join key between what the browser measured and the
 * element our rules are looking at. Since we analyze the browser's own
 * serialized DOM, the two trees agree.
 */
const COLLECT = `() => {
  function cssPath(node) {
    const parts = [];
    let current = node;
    while (current && current.nodeType === 1) {
      const tag = current.tagName.toLowerCase();
      if (tag === 'html') break;
      const id = current.getAttribute('id');
      if (id && /^[A-Za-z][\\w-]*$/.test(id)) { parts.unshift('#' + id); break; }
      const parent = current.parentElement;
      let part = tag;
      if (parent) {
        const sameTag = Array.prototype.filter.call(parent.children, function (c) {
          return c.tagName.toLowerCase() === tag;
        });
        if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(current) + 1) + ')';
      }
      parts.unshift(part);
      current = parent;
    }
    return parts.join(' > ') || 'html';
  }

  function ownText(el) {
    let text = '';
    for (const node of el.childNodes) {
      if (node.nodeType === 3) text += node.data;
    }
    return text.replace(/\\s+/g, ' ').trim();
  }

  // Walk up for the first ancestor painting an opaque background, the way a
  // person perceives the backdrop behind the text.
  function effectiveBackground(el) {
    let node = el;
    while (node && node.nodeType === 1) {
      const bg = getComputedStyle(node).backgroundColor;
      const match = bg.match(/rgba?\\(([^)]+)\\)/);
      if (match) {
        const parts = match[1].split(',').map(function (p) { return parseFloat(p); });
        const alpha = parts.length > 3 ? parts[3] : 1;
        if (alpha > 0.95) return bg;
      }
      node = node.parentElement;
    }
    return 'rgb(255, 255, 255)';
  }

  const INTERACTIVE = 'a[href],button,input,select,textarea,summary,[role=button],[role=link],[tabindex]';
  const result = {};
  let count = 0;

  for (const el of document.querySelectorAll('*')) {
    if (count > 4000) break;
    const tag = el.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style' || tag === 'head' || tag === 'meta' || tag === 'link') continue;

    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') continue;

    const text = ownText(el);
    const interactive = el.matches(INTERACTIVE);
    if (!text && !interactive) continue;

    const rect = el.getBoundingClientRect();
    const entry = {
      visible: rect.width > 0 && rect.height > 0,
      width: Math.round(rect.width * 10) / 10,
      height: Math.round(rect.height * 10) / 10,
    };

    if (text) {
      entry.text = text.slice(0, 120);
      entry.color = style.color;
      entry.background = effectiveBackground(el);
      entry.fontSize = parseFloat(style.fontSize) || 16;
      entry.fontWeight = style.fontWeight;
      entry.opacity = parseFloat(style.opacity);
      entry.textAlign = style.textAlign;
    }
    if (interactive) {
      entry.interactive = true;
      entry.outlineStyle = style.outlineStyle;
      entry.outlineWidth = style.outlineWidth;
      entry.display = style.display;
      entry.position = style.position;
    }

    result[cssPath(el)] = entry;
    count += 1;
  }

  return {
    styles: result,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  };
}`;

/**
 * Render a page in a real browser and return its post-JavaScript DOM plus a
 * map of computed styles keyed by CSS selector.
 */
export async function renderWithBrowser(rawUrl, { timeoutMs = config.render.timeoutMs } = {}) {
  const url = await assertPublicUrl(rawUrl);
  const browser = await getBrowser();

  const context = await browser.newContext({
    userAgent: config.crawler.userAgent,
    viewport: { width: config.render.viewportWidth, height: config.render.viewportHeight },
    // Reduced motion keeps animation from interfering with measurement, and is
    // also how a meaningful share of real users browse.
    reducedMotion: 'reduce',
    javaScriptEnabled: true,
  });

  try {
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);

    // Media and fonts do not change the accessibility tree and cost real time.
    await page.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'media', 'font'].includes(type)) return route.abort();
      return route.continue();
    });

    const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    // Give client-side frameworks a chance to paint before measuring.
    await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 8000) }).catch(() => {});

    // COLLECT is an arrow-function source string; wrap it so it is invoked
    // rather than merely evaluated to a (non-serializable) function object.
    const collected = await page.evaluate(`(${COLLECT})()`);
    const html = await page.content();
    const finalUrl = page.url();

    // Re-validate: JavaScript may have navigated somewhere we would not fetch.
    await assertPublicUrl(finalUrl);

    return {
      url: finalUrl,
      status: response ? response.status() : 200,
      html,
      css: '',
      computed: collected.styles,
      layout: { scrollWidth: collected.scrollWidth, clientWidth: collected.clientWidth },
      mode: 'browser',
      bytes: html.length,
    };
  } finally {
    await context.close().catch(() => {});
  }
}

/** Fetch a page without a browser, including its same-origin stylesheets. */
export async function renderStatic(rawUrl) {
  const response = await safeFetch(rawUrl);
  if (!/text\/html|application\/xhtml/i.test(response.contentType)) {
    const error = new Error('That URL did not return an HTML page.');
    error.userFacing = true;
    error.code = 'not_html';
    throw error;
  }

  const sheetUrls = extractStylesheetUrls(response.body, response.url);
  const sheets = await Promise.all(
    sheetUrls.map(async (sheetUrl) => {
      try {
        const sheet = await safeFetch(sheetUrl, { accept: 'text/css', maxBytes: 2_000_000 });
        return sheet.status < 400 ? sheet.body : '';
      } catch {
        return '';
      }
    })
  );

  return {
    url: response.url,
    status: response.status,
    html: response.body,
    css: sheets.join('\n'),
    computed: null,
    layout: null,
    mode: 'static',
    bytes: response.body.length,
  };
}

/**
 * Render using the best available mode, falling back to a plain fetch if the
 * browser is unavailable or fails. A scan should never fail because rendering
 * is unavailable — it should just report less coverage, honestly.
 */
export async function renderPage(url, { preferBrowser = null } = {}) {
  const wantBrowser = preferBrowser === null ? config.render.mode !== 'static' : preferBrowser;

  if (wantBrowser && (await browserAvailable())) {
    try {
      return await renderWithBrowser(url);
    } catch (err) {
      if (err.userFacing) throw err;
      log.warn('browser render failed, falling back to static', { url, error: err.message });
    }
  }
  return renderStatic(url);
}

export default renderPage;
