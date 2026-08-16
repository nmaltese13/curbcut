import { html, raw, toString } from './html.js';
import config from '../config.js';

/**
 * The Curbcut mark: a curb cut drawn in profile — street level, the ramp, then
 * sidewalk level. The curb-cut effect (an accommodation built for disabled
 * people that ends up helping everyone) is the canonical metaphor in this field,
 * so the logo says what the company is to anyone in the industry.
 *
 * Rendered inline rather than as an image file so it inherits the theme colors
 * and stays sharp at any size.
 */
export function logoMark(size = 28) {
  return html`<svg class="brand-mark" width="${String(size)}" height="${String(size)}"
       viewBox="0 0 32 32" role="img" aria-hidden="true" focusable="false">
    <rect class="brand-mark-bg" width="32" height="32" rx="8"/>
    <path class="brand-mark-ramp" d="M6 23 H12 L20 11 H26"
          fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}

export const BRAND = {
  name: 'Curbcut',
  tagline: 'Find it, fix it, prove it.',
  description:
    'Curbcut finds the accessibility failures on your site, writes the code that fixes them, and keeps the dated evidence you need for procurement and legal.',
};

function header(ctx) {
  const { user, org, path } = ctx;
  const current = (href) => (path === href ? raw(' aria-current="page"') : raw(''));

  return html`
    <header class="site-header">
      <div class="wrap">
        <a class="brand" href="/">
          ${logoMark(28)}
          ${BRAND.name}
        </a>
        <nav class="site-nav" aria-label="Main">
          ${user
            ? html`
                <a href="/app"${current('/app')}>Dashboard</a>
                <a href="/app/sites"${current('/app/sites')}>Sites</a>
                <a href="/app/settings"${current('/app/settings')}>Settings</a>
                ${ctx.isAdmin ? html`<a href="/admin">Admin</a>` : ''}
                <form method="post" action="/logout" style="display:inline">
                  <input type="hidden" name="_csrf" value="${ctx.csrf}">
                  <button type="submit" class="btn btn-ghost btn-sm">Sign out</button>
                </form>
              `
            : html`
                <a href="/how-it-works"${current('/how-it-works')}>How it works</a>
                <a href="/pricing"${current('/pricing')}>Pricing</a>
                <a href="/services"${current('/services')}>Services</a>
                <a href="/docs"${current('/docs')}>Docs</a>
                <a href="/login">Sign in</a>
                <a class="btn btn-primary btn-sm" href="/signup">Get a free scan</a>
              `}
        </nav>
      </div>
    </header>
  `;
}

function footer() {
  return html`
    <footer class="site-footer">
      <div class="wrap">
        <div>
          <a class="brand" href="/" style="margin-bottom:.5rem">
            ${logoMark(26)}${BRAND.name}
          </a>
          <p class="small" style="max-width:34ch">
            Accessibility remediation and conformance evidence for teams that ship.
          </p>
        </div>
        <div>
          <h2>Product</h2>
          <a href="/how-it-works">How it works</a>
          <a href="/pricing">Pricing</a>
          <a href="/services">Done-for-you services</a>
          <a href="/docs">Documentation</a>
          <a href="/docs/api">API reference</a>
        </div>
        <div>
          <h2>Learn</h2>
          <a href="/guides/ada-compliance">ADA &amp; web accessibility</a>
          <a href="/guides/european-accessibility-act">European Accessibility Act</a>
          <a href="/guides/vpat">What is a VPAT?</a>
          <a href="/guides/overlays">Why overlays fail</a>
        </div>
        <div>
          <h2>Company</h2>
          <a href="/legal/privacy">Privacy</a>
          <a href="/legal/terms">Terms</a>
          <a href="/accessibility">Our accessibility statement</a>
        </div>
      </div>
      <div class="wrap" style="margin-top:2rem">
        <p class="small tight">&copy; ${new Date().getFullYear()} ${BRAND.name}. Automated testing detects a subset of accessibility barriers; it does not replace testing with people who use assistive technology.</p>
      </div>
    </footer>
  `;
}

/**
 * Render a full page. Every page gets a lang attribute, a unique title, a skip
 * link, a main landmark and labeled navigation, because our own product has to
 * pass the checks we sell.
 */
export function page({ title, description = BRAND.description, body, ctx = {}, bodyClass = '', head = '' }) {
  const fullTitle = title ? `${title} · ${BRAND.name}` : `${BRAND.name} — ${BRAND.tagline}`;

  return toString(html`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${description}">
<meta property="og:title" content="${fullTitle}">
<meta property="og:description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${BRAND.name}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/assets/app.css">
<link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
${raw(head)}
</head>
<body class="${bodyClass}">
<a class="skip-link" href="#main-content">Skip to main content</a>
${header(ctx)}
<main id="main-content">
${body}
</main>
${footer()}
</body>
</html>`);
}

/** A smaller shell for documents rendered for print or export. */
export function documentPage({ title, body }) {
  return toString(html`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="/assets/app.css">
</head>
<body>
<a class="skip-link" href="#main-content">Skip to main content</a>
<main id="main-content" class="wrap-narrow doc-content" style="padding-top:3rem;padding-bottom:4rem">
${raw(body)}
</main>
</body>
</html>`);
}

// Standalone file, so the colors are literal rather than theme variables.
export const FAVICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="#2440c4"/>
  <path d="M6 23 H12 L20 11 H26" fill="none" stroke="#ffffff"
        stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

/* ------------------------------------------------------------------ *
 * Shared view fragments
 * ------------------------------------------------------------------ */

export function scoreColor(score) {
  if (score >= 90) return 'var(--success)';
  if (score >= 70) return 'var(--moderate)';
  if (score >= 50) return 'var(--serious)';
  return 'var(--critical)';
}

export function scoreRing(score, { small = false, label = 'Accessibility score' } = {}) {
  return html`
    <div class="score ${small ? 'score-sm' : ''}"
         style="--score:${String(score)};--score-color:${raw(scoreColor(score))}"
         role="img" aria-label="${label}: ${String(score)} out of 100">
      <span class="score-value" aria-hidden="true">${score}</span>
    </div>
  `;
}

export function impactBadge(impact) {
  return html`<span class="badge badge-${impact}">${impact}</span>`;
}

export function confidenceBadge(confidence) {
  return confidence === 'definite'
    ? html`<span class="badge badge-outline" title="Machine-verifiable failure">confirmed</span>`
    : html`<span class="badge badge-outline" title="Strong signal that needs a human decision">needs review</span>`;
}

export function alert(kind, message) {
  if (!message) return '';
  return html`<div class="alert alert-${kind}" role="${kind === 'error' ? 'alert' : 'status'}"><p>${message}</p></div>`;
}

/** Render a unified diff with color coding. */
export function renderDiff(diff) {
  if (!diff) return '';
  const lines = diff.split('\n').map((line) => {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')) {
      return html`<span class="meta">${line}</span>`;
    }
    if (line.startsWith('+')) return html`<span class="add">${line}</span>`;
    if (line.startsWith('-')) return html`<span class="del">${line}</span>`;
    return html`<span class="ctx">${line}</span>`;
  });
  return html`<div class="diff"><pre>${lines}</pre></div>`;
}

export { config };
