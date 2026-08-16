import dns from 'node:dns/promises';
import net from 'node:net';
import config from '../config.js';
import log from '../log.js';

/**
 * Users submit arbitrary URLs to be fetched by our servers, which is a textbook
 * SSRF surface. Every hostname is resolved and checked against private ranges
 * before we connect, and every redirect hop is re-validated.
 */
const BLOCKED_V4 = [
  [10, 8], [127, 8], [169, 16], [172, 12], [192, 16], [0, 8], [100, 10], [198, 15], [224, 4],
];

function isPrivateIPv4(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 169 && b === 254) return true;            // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;  // carrier-grade NAT
  if (a >= 224) return true;                          // multicast / reserved
  return false;
}

function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fe80') || normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  // IPv4-mapped addresses such as ::ffff:127.0.0.1
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

/**
 * Pure, environment-independent check for addresses that must never be fetched
 * on a user's behalf. Kept separate from policy so it can be tested exhaustively.
 */
export function isPrivateHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host) return true;
  if (LOOPBACK.has(host)) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.localhost')) return true;
  if (net.isIPv4(host)) return isPrivateIPv4(host);
  if (net.isIPv6(host)) return isPrivateIPv6(host);
  return false;
}

export async function assertPublicUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ScanError('That does not look like a valid URL.', 'invalid_url');
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ScanError('Only http and https URLs can be scanned.', 'invalid_scheme');
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  // Loopback only, and only outside production, so the app can scan itself for
  // demos and dogfooding. Private network ranges and cloud metadata endpoints
  // stay blocked in every environment, including this one.
  if (!config.isProd && LOOPBACK.has(hostname.toLowerCase())) {
    return url;
  }

  if (net.isIP(hostname)) {
    if (isPrivateHost(hostname)) {
      throw new ScanError('That address is not publicly reachable.', 'private_address');
    }
    return url;
  }

  if (isPrivateHost(hostname)) {
    throw new ScanError('That address is not publicly reachable.', 'private_address');
  }

  let records;
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    throw new ScanError(`Could not resolve ${hostname}.`, 'dns_failure');
  }
  if (!records.length) throw new ScanError(`Could not resolve ${hostname}.`, 'dns_failure');

  for (const record of records) {
    const priv = record.family === 4 ? isPrivateIPv4(record.address) : isPrivateIPv6(record.address);
    if (priv) throw new ScanError('That host resolves to a private address and cannot be scanned.', 'private_address');
  }

  return url;
}

export class ScanError extends Error {
  constructor(message, code = 'scan_error') {
    super(message);
    this.name = 'ScanError';
    this.code = code;
    this.userFacing = true;
  }
}

/** Fetch with redirect validation, timeout and a response size cap. */
export async function safeFetch(rawUrl, { accept = 'text/html', maxBytes = config.crawler.maxBytesPerPage } = {}) {
  let current = await assertPublicUrl(rawUrl);
  let hops = 0;

  while (hops < 5) {
    const response = await fetch(current.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(config.crawler.timeoutMs),
      headers: {
        'User-Agent': config.crawler.userAgent,
        Accept: `${accept},*/*;q=0.8`,
        'Accept-Language': 'en',
      },
    });

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const target = response.headers.get('location');
      if (!target) throw new ScanError('The server sent a redirect with no destination.', 'bad_redirect');
      const next = new URL(target, current.href);
      // Re-validate every hop; a redirect into a private range is the classic bypass.
      current = await assertPublicUrl(next.href);
      hops += 1;
      continue;
    }

    const contentType = response.headers.get('content-type') || '';
    const declaredLength = Number(response.headers.get('content-length') || 0);
    if (declaredLength && declaredLength > maxBytes) {
      throw new ScanError('That page is too large to analyze.', 'too_large');
    }

    // Stream so an unbounded response cannot exhaust memory.
    const reader = response.body?.getReader();
    let received = 0;
    const chunks = [];
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.length;
        if (received > maxBytes) {
          await reader.cancel();
          throw new ScanError('That page is too large to analyze.', 'too_large');
        }
        chunks.push(value);
      }
    }
    const body = Buffer.concat(chunks).toString('utf8');

    return { url: current.href, status: response.status, contentType, body };
  }

  throw new ScanError('Too many redirects.', 'too_many_redirects');
}

/* ------------------------------------------------------------------ *
 * robots.txt
 * ------------------------------------------------------------------ */

export function parseRobots(text, userAgent = 'curbcutbot') {
  const groups = [];
  let current = null;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.split('#')[0].trim();
    if (!line) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'user-agent') {
      if (!current || current.rules.length) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current && (field === 'allow' || field === 'disallow')) {
      current.rules.push({ type: field, path: value });
    }
  }

  const ua = userAgent.toLowerCase();
  const specific = groups.find((g) => g.agents.some((a) => a !== '*' && ua.includes(a)));
  const wildcard = groups.find((g) => g.agents.includes('*'));
  const active = specific || wildcard;
  if (!active) return { allowed: () => true };

  return {
    allowed(pathname) {
      let verdict = true;
      let longest = -1;
      for (const rule of active.rules) {
        if (!rule.path) continue;
        const pattern = rule.path.replace(/\*/g, '');
        if (!pathname.startsWith(pattern)) continue;
        if (pattern.length > longest) {
          longest = pattern.length;
          verdict = rule.type === 'allow';
        }
      }
      return verdict;
    },
  };
}

async function loadRobots(origin) {
  try {
    const result = await safeFetch(new URL('/robots.txt', origin).href, { accept: 'text/plain', maxBytes: 512_000 });
    if (result.status >= 400) return { allowed: () => true };
    return parseRobots(result.body, config.crawler.userAgent);
  } catch {
    // A missing or unreachable robots.txt means no restrictions.
    return { allowed: () => true };
  }
}

/* ------------------------------------------------------------------ *
 * Link and stylesheet discovery
 * ------------------------------------------------------------------ */

const SKIP_EXTENSIONS = /\.(pdf|zip|jpe?g|png|gif|svg|webp|avif|ico|mp4|mp3|webm|woff2?|ttf|eot|css|js|json|xml|rss|csv|docx?|xlsx?|pptx?)(\?|$)/i;

export function extractLinks(html, baseUrl) {
  const links = new Set();
  const base = new URL(baseUrl);
  const pattern = /<a\b[^>]*?\shref\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const raw = (match[2] ?? match[3] ?? match[4] ?? '').trim();
    if (!raw || raw.startsWith('#') || /^(mailto|tel|javascript|data):/i.test(raw)) continue;
    let target;
    try {
      target = new URL(raw, base);
    } catch {
      continue;
    }
    if (target.origin !== base.origin) continue;
    if (SKIP_EXTENSIONS.test(target.pathname)) continue;
    target.hash = '';
    links.add(target.href);
  }
  return [...links];
}

export function extractStylesheetUrls(html, baseUrl) {
  const urls = [];
  const base = new URL(baseUrl);
  const pattern = /<link\b[^>]*>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const tag = match[0];
    if (!/rel\s*=\s*["']?[^"'>]*stylesheet/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*("([^"]*)"|'([^']*)'|([^\s">]+))/i);
    if (!href) continue;
    const raw = (href[2] ?? href[3] ?? href[4] ?? '').trim();
    if (!raw) continue;
    try {
      const target = new URL(raw, base);
      if (target.origin !== base.origin) continue; // Skip third-party CDNs.
      urls.push(target.href);
    } catch {
      /* ignore malformed href */
    }
  }
  return urls.slice(0, 8);
}

async function fetchStylesheets(html, pageUrl) {
  const urls = extractStylesheetUrls(html, pageUrl);
  const sheets = await Promise.all(
    urls.map(async (url) => {
      try {
        const result = await safeFetch(url, { accept: 'text/css', maxBytes: 2_000_000 });
        return result.status < 400 ? result.body : '';
      } catch {
        return '';
      }
    })
  );
  return sheets.join('\n');
}

/**
 * Discover URLs from sitemap.xml, following sitemap index files one level deep.
 * A sitemap is the site's own statement of what matters, so these URLs are
 * crawled ahead of anything found by following links.
 */
export async function discoverFromSitemap(origin, { limit = 500 } = {}) {
  const found = [];
  const seenSitemaps = new Set();

  const readSitemap = async (sitemapUrl, depth = 0) => {
    if (depth > 1 || found.length >= limit || seenSitemaps.has(sitemapUrl)) return;
    seenSitemaps.add(sitemapUrl);
    try {
      const result = await safeFetch(sitemapUrl, { accept: 'application/xml', maxBytes: 10_000_000 });
      if (result.status >= 400) return;

      const isIndex = /<sitemapindex/i.test(result.body);
      const locations = [...result.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);

      for (const location of locations) {
        if (found.length >= limit) break;
        let parsed;
        try {
          parsed = new URL(location);
        } catch {
          continue;
        }
        if (parsed.origin !== origin) continue;
        if (isIndex) {
          await readSitemap(parsed.href, depth + 1);
        } else if (!SKIP_EXTENSIONS.test(parsed.pathname)) {
          parsed.hash = '';
          found.push(parsed.href);
        }
      }
    } catch {
      /* No sitemap, or unreachable. Link discovery still applies. */
    }
  };

  // robots.txt may point at sitemaps in non-standard locations.
  const candidates = ['/sitemap.xml', '/sitemap_index.xml'];
  try {
    const robots = await safeFetch(new URL('/robots.txt', origin).href, { accept: 'text/plain', maxBytes: 512_000 });
    for (const match of robots.body.matchAll(/^\s*sitemap:\s*(\S+)/gim)) {
      try {
        const parsed = new URL(match[1]);
        if (parsed.origin === origin) candidates.unshift(parsed.href);
      } catch { /* ignore malformed entry */ }
    }
  } catch { /* ignore */ }

  for (const candidate of candidates.slice(0, 5)) {
    if (found.length >= limit) break;
    await readSitemap(new URL(candidate, origin).href);
  }

  return [...new Set(found)];
}

/**
 * Score a URL for crawl priority.
 *
 * Breadth matters more than depth: scanning twenty distinct page templates finds
 * far more distinct problems than scanning twenty near-identical product pages.
 * Shallow URLs and unseen path shapes are therefore visited first.
 */
export function crawlPriority(url, seenShapes) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return 1000;
  }
  const segments = parsed.pathname.split('/').filter(Boolean);
  let score = segments.length * 10;

  // A path shape treats numeric and id-like segments as interchangeable, so
  // /product/1 and /product/2 collapse to the same template.
  const shape = segments.map((s) => (/^\d+$/.test(s) || s.length > 24 ? ':id' : s)).join('/');
  if (seenShapes.has(shape)) score += 200 + seenShapes.get(shape) * 40;

  if (parsed.search) score += 30;
  // Pages most likely to carry legal and conversion risk.
  if (/(checkout|cart|payment|account|login|signup|register|contact|search|booking|apply)/i.test(parsed.pathname)) score -= 60;
  if (segments.length === 0) score -= 100;

  return score;
}

function pathShape(url) {
  try {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    return segments.map((s) => (/^\d+$/.test(s) || s.length > 24 ? ':id' : s)).join('/');
  } catch {
    return url;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Crawl a site breadth-first from a starting URL.
 * @returns {Promise<Array<{url,status,html,css,error}>>}
 */
export async function crawl(startUrl, {
  maxPages = 25,
  onPage = null,
  onEvent = null,
  respectRobots = true,
  useSitemap = true,
  // Injected by the caller so this module never imports the renderer, which
  // depends on it. Defaults to a plain fetch plus same-origin stylesheets.
  renderer = null,
} = {}) {
  const start = await assertPublicUrl(startUrl);
  const emit = (event) => { if (onEvent) { try { onEvent(event); } catch { /* never break a scan on a listener */ } } };

  emit({ type: 'phase', phase: 'robots', message: `Reading robots.txt for ${start.origin}` });
  const robots = respectRobots ? await loadRobots(start.origin) : { allowed: () => true };

  const seen = new Set([start.href]);
  let queue = [start.href];

  if (useSitemap) {
    emit({ type: 'phase', phase: 'sitemap', message: 'Looking for a sitemap' });
    const sitemapUrls = await discoverFromSitemap(start.origin, { limit: Math.max(maxPages * 4, 200) });
    let added = 0;
    for (const url of sitemapUrls) {
      if (seen.has(url)) continue;
      seen.add(url);
      queue.push(url);
      added += 1;
    }
    emit({
      type: 'phase',
      phase: 'sitemap',
      message: added ? `Sitemap listed ${added} pages` : 'No sitemap found, following links instead',
    });
  }

  const shapes = new Map();
  const pages = [];

  const takeBatch = (size) => {
    // Re-rank on every batch: newly discovered templates should outrank the
    // hundredth instance of one already covered.
    queue.sort((a, b) => crawlPriority(a, shapes) - crawlPriority(b, shapes));
    return queue.splice(0, size);
  };

  while (queue.length && pages.length < maxPages) {
    const batch = takeBatch(Math.min(config.crawler.concurrency, maxPages - pages.length));

    const results = await Promise.all(
      batch.map(async (url) => {
        const pathname = new URL(url).pathname;
        if (!robots.allowed(pathname)) {
          emit({ type: 'skip', url, reason: 'Disallowed by robots.txt' });
          return { url, skipped: true, reason: 'Disallowed by robots.txt' };
        }
        emit({ type: 'fetch', url });
        try {
          if (renderer) {
            const rendered = await renderer(url);
            return { ...rendered, bytes: rendered.bytes ?? rendered.html.length };
          }
          const response = await safeFetch(url);
          if (!/text\/html|application\/xhtml/i.test(response.contentType)) {
            emit({ type: 'skip', url, reason: 'Not an HTML page' });
            return { url, skipped: true, reason: 'Not an HTML page' };
          }
          const css = await fetchStylesheets(response.body, response.url);
          return {
            url: response.url, status: response.status, html: response.body, css,
            mode: 'static', bytes: response.body.length,
          };
        } catch (err) {
          log.warn('crawl page failed', { url, error: err.message });
          emit({ type: 'error', url, message: err.message });
          return { url, error: err.message, status: null };
        }
      })
    );

    for (const result of results) {
      if (result.skipped) continue;
      if (pages.length >= maxPages) break;
      pages.push(result);
      shapes.set(pathShape(result.url), (shapes.get(pathShape(result.url)) || 0) + 1);
      if (onPage) await onPage(result, pages.length);

      if (result.html) {
        let discovered = 0;
        for (const link of extractLinks(result.html, result.url)) {
          if (seen.has(link) || seen.size >= maxPages * 20) continue;
          seen.add(link);
          queue.push(link);
          discovered += 1;
        }
        if (discovered) emit({ type: 'discovered', url: result.url, count: discovered, queued: queue.length });
      }
    }

    if (queue.length && pages.length < maxPages) await sleep(config.crawler.politeDelayMs);
  }

  emit({ type: 'phase', phase: 'crawl-complete', message: `Crawled ${pages.length} pages` });
  return pages;
}

export default crawl;
