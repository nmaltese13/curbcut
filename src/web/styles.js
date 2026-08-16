/**
 * The stylesheet is served as one cached file with no build step and no external
 * requests. Every color pair below is checked against WCAG AA, because shipping
 * an accessibility product with failing contrast would be indefensible.
 */
export const STYLES = `
:root {
  color-scheme: light dark;

  --bg: #ffffff;
  --bg-subtle: #f6f7fb;
  --bg-raised: #ffffff;
  --bg-inset: #eef1f8;
  --text: #14182a;
  --text-muted: #4d5670;
  --border: #d9dee9;
  --border-strong: #b9c1d4;

  --accent: #2440c4;
  --accent-hover: #1c33a0;
  --accent-contrast: #ffffff;
  --accent-subtle: #eef1fe;

  --critical: #b3261e;
  --critical-bg: #fdecea;
  --serious: #a8460a;
  --serious-bg: #fdefe4;
  --moderate: #7a5a00;
  --moderate-bg: #fdf5df;
  --minor: #4d5670;
  --minor-bg: #eef1f8;
  --success: #0f6d43;
  --success-bg: #e6f5ed;

  --radius: 10px;
  --radius-lg: 16px;
  --shadow: 0 1px 2px rgba(16, 24, 48, .06), 0 4px 16px rgba(16, 24, 48, .06);
  --shadow-lg: 0 2px 6px rgba(16, 24, 48, .08), 0 16px 40px rgba(16, 24, 48, .10);
  --max: 1120px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0d1117;
    --bg-subtle: #121822;
    --bg-raised: #161d29;
    --bg-inset: #1b2430;
    --text: #e8edf5;
    --text-muted: #a3aec2;
    --border: #2a3444;
    --border-strong: #3d4a5f;

    --accent: #8fa5ff;
    --accent-hover: #adbcff;
    --accent-contrast: #0d1117;
    --accent-subtle: #1a2138;

    --critical: #ff9d94;
    --critical-bg: #2c1614;
    --serious: #ffb182;
    --serious-bg: #2b1a10;
    --moderate: #f0cf6a;
    --moderate-bg: #272014;
    --minor: #a3aec2;
    --minor-bg: #1b2430;
    --success: #6edba4;
    --success-bg: #0f2419;

    --shadow: 0 1px 2px rgba(0,0,0,.3), 0 4px 16px rgba(0,0,0,.3);
    --shadow-lg: 0 2px 6px rgba(0,0,0,.4), 0 16px 40px rgba(0,0,0,.4);
  }
}

*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  font-family: var(--font);
  font-size: 16px;
  line-height: 1.6;
  color: var(--text);
  background: var(--bg);
  -webkit-font-smoothing: antialiased;
}

h1, h2, h3, h4 { line-height: 1.2; margin: 0 0 .5em; font-weight: 650; letter-spacing: -.02em; }
h1 { font-size: clamp(1.9rem, 4vw, 2.6rem); }
h2 { font-size: clamp(1.4rem, 3vw, 1.8rem); }
h3 { font-size: 1.15rem; }
p { margin: 0 0 1rem; }
a { color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 2px; }
a:hover { color: var(--accent-hover); }

:focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
  border-radius: 3px;
}

/* Available to screen readers, clipped visually. Preferred over display:none,
   which would remove the text from the accessibility tree entirely. */
.visually-hidden {
  position: absolute !important;
  width: 1px; height: 1px;
  margin: -1px; padding: 0; border: 0;
  clip-path: inset(50%);
  overflow: hidden; white-space: nowrap;
}

.skip-link {
  position: absolute; left: -9999px; top: 0; z-index: 100;
  background: var(--accent); color: var(--accent-contrast);
  padding: .75rem 1.25rem; border-radius: 0 0 var(--radius) 0; font-weight: 600;
}
.skip-link:focus { left: 0; }

.wrap { max-width: var(--max); margin: 0 auto; padding: 0 1.25rem; }
.wrap-narrow { max-width: 760px; margin: 0 auto; padding: 0 1.25rem; }

/* ---------- header ---------- */
.site-header {
  border-bottom: 1px solid var(--border);
  background: var(--bg);
  position: sticky; top: 0; z-index: 50;
}
.site-header .wrap { display: flex; align-items: center; gap: 1.5rem; height: 64px; }
.brand {
  display: inline-flex; align-items: center; gap: .55rem;
  font-weight: 700; font-size: 1.1rem; color: var(--text); text-decoration: none;
  letter-spacing: -.02em; flex-shrink: 0;
}
.brand:hover { color: var(--text); }
/* The mark is a curb cut in profile: street level, ramp, sidewalk level. */
.brand-mark { flex-shrink: 0; display: block; }
.brand-mark-bg { fill: var(--accent); }
.brand-mark-ramp { stroke: var(--accent-contrast); }

.site-nav { display: flex; gap: .35rem; align-items: center; margin-left: auto; flex-wrap: wrap; }

/* :not(.btn) matters. Without it these rules outrank .btn-primary:hover on
   specificity and repaint the call-to-action as a plain grey nav link. */
.site-nav a:not(.btn) {
  color: var(--text-muted); text-decoration: none; font-weight: 550; font-size: .94rem;
  padding: .45rem .7rem; border-radius: var(--radius);
}
.site-nav a:not(.btn):hover { color: var(--text); background: var(--bg-subtle); }
.site-nav a:not(.btn)[aria-current="page"] { color: var(--accent); background: var(--accent-subtle); }
.site-nav .btn { margin-left: .3rem; }

/* ---------- buttons ---------- */
.btn {
  display: inline-flex; align-items: center; justify-content: center; gap: .5rem;
  padding: .68rem 1.15rem; border-radius: var(--radius); border: 1px solid transparent;
  font: inherit; font-weight: 600; font-size: .95rem; cursor: pointer;
  text-decoration: none; transition: background .12s, border-color .12s, color .12s;
  white-space: nowrap;
}
.btn-primary {
  background: var(--accent); color: var(--accent-contrast);
  box-shadow: 0 1px 2px rgba(16, 24, 48, .12);
}
.btn-primary:hover { background: var(--accent-hover); color: var(--accent-contrast); }
.btn-secondary { background: var(--bg-raised); color: var(--text); border-color: var(--border-strong); }
.btn-secondary:hover { background: var(--bg-subtle); color: var(--text); }
.btn-ghost { background: transparent; color: var(--text-muted); }
.btn-ghost:hover { background: var(--bg-subtle); color: var(--text); }
.btn-danger { background: transparent; color: var(--critical); border-color: var(--critical); }
.btn-danger:hover { background: var(--critical-bg); color: var(--critical); }
.btn-sm { padding: .35rem .7rem; font-size: .85rem; }
.btn-lg { padding: .85rem 1.6rem; font-size: 1.02rem; }
.btn:disabled, .btn[aria-disabled="true"] { opacity: .55; cursor: not-allowed; }

/* ---------- forms ---------- */
.field { margin-bottom: 1.1rem; }
.field label { display: block; font-weight: 600; font-size: .92rem; margin-bottom: .35rem; }
.field .hint { font-size: .85rem; color: var(--text-muted); margin: .3rem 0 0; }
input[type=text], input[type=email], input[type=password], input[type=url], select, textarea {
  width: 100%; padding: .65rem .8rem; font: inherit; font-size: .97rem;
  color: var(--text); background: var(--bg-raised);
  border: 1px solid var(--border-strong); border-radius: var(--radius);
}
input:focus-visible, select:focus-visible, textarea:focus-visible { border-color: var(--accent); }
input[aria-invalid="true"] { border-color: var(--critical); }

/* ---------- cards & layout ---------- */
.card {
  background: var(--bg-raised); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 1.5rem;
}

/* Cards that are themselves links get affordance without losing text color. */
.card-link {
  display: block; text-decoration: none; color: inherit;
  transition: border-color .14s ease, box-shadow .14s ease, transform .14s ease;
}
.card-link:hover {
  color: inherit; border-color: var(--border-strong);
  box-shadow: var(--shadow); transform: translateY(-2px);
}
.card-link:focus-visible { transform: translateY(-2px); }
.card-flush { padding: 0; overflow: hidden; }
.card-header {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  padding: 1.1rem 1.5rem; border-bottom: 1px solid var(--border); flex-wrap: wrap;
}
.card-header h2, .card-header h3 { margin: 0; }
.grid { display: grid; gap: 1.25rem; }
.grid-2 { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }
.grid-3 { grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); }
.grid-4 { grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }
.stack > * + * { margin-top: 1.25rem; }
.row { display: flex; gap: .6rem; align-items: center; flex-wrap: wrap; }
.row-between { display: flex; gap: 1rem; align-items: center; justify-content: space-between; flex-wrap: wrap; }
.muted { color: var(--text-muted); }
.small { font-size: .88rem; }
.tight { margin-bottom: 0; }
.center { text-align: center; }
section { margin: 4rem 0; }

/* ---------- badges ---------- */
.badge {
  display: inline-flex; align-items: center; gap: .3rem;
  padding: .15rem .55rem; border-radius: 999px;
  font-size: .78rem; font-weight: 650; letter-spacing: .01em; white-space: nowrap;
}
.badge-critical { background: var(--critical-bg); color: var(--critical); }
.badge-serious  { background: var(--serious-bg); color: var(--serious); }
.badge-moderate { background: var(--moderate-bg); color: var(--moderate); }
.badge-minor    { background: var(--minor-bg); color: var(--minor); }
.badge-success  { background: var(--success-bg); color: var(--success); }
.badge-accent   { background: var(--accent-subtle); color: var(--accent); }
.badge-outline  { border: 1px solid var(--border-strong); color: var(--text-muted); }

/* ---------- score ---------- */
.score {
  --size: 108px;
  width: var(--size); height: var(--size); border-radius: 50%;
  display: grid; place-items: center; flex-shrink: 0;
  background: conic-gradient(var(--score-color) calc(var(--score) * 1%), var(--bg-inset) 0);
  position: relative;
}
.score::after {
  content: ""; position: absolute; inset: 9px; border-radius: 50%; background: var(--bg-raised);
}
.score-value { position: relative; z-index: 1; font-size: 1.9rem; font-weight: 700; letter-spacing: -.03em; }
.score-sm { --size: 56px; }
.score-sm .score-value { font-size: 1.1rem; }
.score-sm::after { inset: 6px; }

/* ---------- tables ---------- */
table { width: 100%; border-collapse: collapse; font-size: .93rem; }
th, td { text-align: left; padding: .7rem .9rem; border-bottom: 1px solid var(--border); vertical-align: top; }
th {
  font-weight: 650; color: var(--text-muted); font-size: .78rem;
  text-transform: uppercase; letter-spacing: .05em;
  background: var(--bg-subtle); border-bottom: 1px solid var(--border-strong);
}
tbody tr { transition: background .1s ease; }
tbody tr:hover { background: var(--bg-subtle); }
tbody tr:last-child td { border-bottom: none; }
.table-wrap { overflow-x: auto; }

/* ---------- alerts ---------- */
.alert {
  padding: .9rem 1.1rem; border-radius: var(--radius); border: 1px solid;
  margin-bottom: 1.25rem; font-size: .94rem;
}
.alert p:last-child { margin-bottom: 0; }
.alert-error { background: var(--critical-bg); border-color: var(--critical); color: var(--critical); }
.alert-success { background: var(--success-bg); border-color: var(--success); color: var(--success); }
.alert-info { background: var(--accent-subtle); border-color: var(--accent); color: var(--text); }
.alert-warn { background: var(--moderate-bg); border-color: var(--moderate); color: var(--moderate); }

/* ---------- code ---------- */
code, pre, .mono { font-family: var(--mono); font-size: .86rem; }
code:not(pre code) {
  background: var(--bg-inset); padding: .12rem .35rem; border-radius: 4px;
  overflow-wrap: anywhere;
}
pre {
  background: var(--bg-inset); border: 1px solid var(--border);
  padding: 1rem; border-radius: var(--radius); overflow-x: auto; margin: 0 0 1rem;
  line-height: 1.5;
}
.diff { background: var(--bg-inset); border-radius: var(--radius); overflow-x: auto; border: 1px solid var(--border); }
.diff pre { margin: 0; border: none; background: none; padding: .9rem 1rem; }
.diff .add { color: var(--success); display: block; }
.diff .del { color: var(--critical); display: block; }
.diff .meta { color: var(--text-muted); display: block; }
.diff .ctx { display: block; color: var(--text-muted); }

/* ---------- marketing ---------- */
/* A faint wash behind the hero adds depth without touching text contrast.
   Painted as the element's own background rather than an oversized pseudo
   element: an absolutely positioned layer using negative viewport insets
   overflows the document and forces horizontal scrolling, which fails WCAG
   1.4.10. Our own scanner caught exactly that here. */
.hero {
  padding: 4.5rem 0 3.25rem;
  position: relative;
  background: radial-gradient(70% 90% at 15% 0%, var(--accent-subtle) 0%, transparent 65%);
}
.hero h1 { max-width: 18ch; margin-bottom: 1.1rem; letter-spacing: -.03em; }
.hero .lede { font-size: 1.2rem; color: var(--text-muted); max-width: 58ch; margin-bottom: 1.9rem; }
.eyebrow {
  display: inline-flex; align-items: center; gap: .45rem; font-size: .82rem; font-weight: 650;
  color: var(--accent); background: var(--accent-subtle);
  padding: .32rem .8rem; border-radius: 999px; margin-bottom: 1.35rem;
  letter-spacing: .01em;
}
.scan-box {
  background: var(--bg-raised); border: 1px solid var(--border);
  border-radius: var(--radius-lg); padding: 1.25rem; box-shadow: var(--shadow-lg);
}
.scan-form { display: flex; gap: .6rem; flex-wrap: wrap; }
.scan-form input { flex: 1 1 260px; }
.compare-table td:first-child { font-weight: 600; }
.check { color: var(--success); font-weight: 700; }
.cross { color: var(--text-muted); }

.price-grid { display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); align-items: start; }
.price-card { position: relative; display: flex; flex-direction: column; height: 100%; }
.price-card.popular { border-color: var(--accent); border-width: 2px; }
.price-tag { font-size: 2.2rem; font-weight: 700; letter-spacing: -.03em; }
.price-card ul { list-style: none; padding: 0; margin: 1rem 0; flex: 1; }
.price-card li { padding-left: 1.5rem; position: relative; margin-bottom: .5rem; font-size: .92rem; }
.price-card li::before {
  content: "✓"; position: absolute; left: 0; color: var(--success); font-weight: 700;
}
.price-card li.no::before { content: "—"; color: var(--text-muted); }
.popular-flag {
  position: absolute; top: -11px; left: 50%; transform: translateX(-50%);
  background: var(--accent); color: var(--accent-contrast);
  padding: .15rem .7rem; border-radius: 999px; font-size: .78rem; font-weight: 650;
}

.stat { padding: 1.35rem 1.4rem; }
.stat-value {
  font-size: 2.05rem; font-weight: 700; letter-spacing: -.035em; line-height: 1.05;
  font-variant-numeric: tabular-nums; margin: 0;
}
.stat-label { color: var(--text-muted); font-size: .86rem; margin: .35rem 0 0; line-height: 1.45; }

.empty {
  text-align: center; padding: 3rem 1.5rem; color: var(--text-muted);
  border: 1px dashed var(--border-strong); border-radius: var(--radius-lg);
}
.empty h3 { color: var(--text); }

.finding {
  border: 1px solid var(--border); border-radius: var(--radius);
  margin-bottom: .8rem; background: var(--bg-raised); overflow: hidden;
}
.finding summary {
  padding: .9rem 1.1rem; cursor: pointer; display: flex; gap: .7rem;
  align-items: center; flex-wrap: wrap; font-weight: 600;
}
.finding summary::marker { color: var(--text-muted); }
.finding summary:hover { background: var(--bg-subtle); }
.finding-body { padding: 0 1.1rem 1.1rem; border-top: 1px solid var(--border); padding-top: 1rem; }
.occurrence {
  border-left: 3px solid var(--border-strong); padding: .5rem 0 .5rem .8rem;
  margin-bottom: .8rem; font-size: .9rem;
}
.occurrence code { display: block; margin-top: .3rem; white-space: pre-wrap; }

.site-footer {
  border-top: 1px solid var(--border); margin-top: 5rem; padding: 2.5rem 0;
  color: var(--text-muted); font-size: .92rem;
}
.site-footer .wrap { display: flex; gap: 2rem; justify-content: space-between; flex-wrap: wrap; }
.site-footer a { color: var(--text-muted); text-decoration: none; display: block; padding: .18rem 0; }
.site-footer a:hover { color: var(--accent); text-decoration: underline; }
.site-footer h2 { font-size: .82rem; text-transform: uppercase; letter-spacing: .05em; color: var(--text); margin-bottom: .4rem; }

.doc-content { line-height: 1.7; }
.doc-content h1 { font-size: 1.7rem; }
.doc-content h2 { font-size: 1.25rem; margin-top: 2rem; }
.doc-content .subtitle { color: var(--text-muted); margin-top: -.5rem; }
.doc-content .callout {
  background: var(--accent-subtle); border-left: 3px solid var(--accent);
  padding: 1rem 1.2rem; border-radius: 0 var(--radius) var(--radius) 0; margin: 1.5rem 0;
}
.doc-content .meta-table th { text-transform: none; font-size: .93rem; width: 32%; color: var(--text); }
.conformance { font-weight: 650; white-space: nowrap; }
.conformance-supports { color: var(--success); }
.conformance-does-not-support { color: var(--critical); }
.conformance-partially-supports { color: var(--serious); }
.conformance-needs-manual-review, .conformance-not-evaluated { color: var(--text-muted); }

.progress { height: 8px; background: var(--bg-inset); border-radius: 999px; overflow: hidden; display: block; }
.progress-bar { height: 100%; background: var(--accent); border-radius: 999px; display: block; transition: width .3s ease; }

/* ---------- live scan activity log ---------- */
.log {
  list-style: none; margin: 0; padding: .5rem 0;
  max-height: 460px; overflow-y: auto;
  font-family: var(--mono); font-size: .82rem; line-height: 1.5;
  background: var(--bg-inset);
}
.log-row {
  display: flex; gap: .7rem; align-items: baseline;
  padding: .2rem 1.1rem;
  border-left: 2px solid transparent;
}
.log-tag {
  flex: 0 0 62px; text-align: right;
  font-weight: 600; font-size: .74rem; text-transform: uppercase; letter-spacing: .03em;
  color: var(--text-muted);
}
.log-body { flex: 1; overflow-wrap: anywhere; color: var(--text); }
.log-meta { color: var(--text-muted); font-size: .76rem; white-space: nowrap; }

.log-fetch .log-tag { color: var(--accent); }
.log-analyze .log-tag { color: var(--text-muted); }
.log-discover .log-tag { color: var(--accent); }
.log-ok { border-left-color: var(--success); }
.log-ok .log-tag { color: var(--success); }
.log-issue { border-left-color: var(--critical); }
.log-issue .log-tag { color: var(--critical); }
.log-detail { padding-left: 3.2rem; }
.log-detail .log-tag { color: var(--serious); }
.log-detail .log-body { color: var(--text-muted); }
.log-warn { border-left-color: var(--moderate); }
.log-warn .log-tag { color: var(--moderate); }
.log-skip .log-body { color: var(--text-muted); }
.log-phase { border-left-color: var(--border-strong); }
.log-done { border-left-color: var(--success); background: var(--success-bg); }
.log-done .log-tag { color: var(--success); }

/* Filter chips for the scan report tiers. */
.chip {
  display: inline-flex; align-items: center; gap: .4rem;
  padding: .35rem .8rem; border-radius: 999px;
  border: 1px solid var(--border-strong); background: var(--bg-raised);
  color: var(--text-muted); text-decoration: none;
  font-size: .88rem; font-weight: 600;
}
.chip:hover { background: var(--bg-subtle); color: var(--text); }
.chip-active {
  background: var(--accent); border-color: var(--accent); color: var(--accent-contrast);
}
.chip-active:hover { background: var(--accent-hover); color: var(--accent-contrast); }
.chip-count {
  font-variant-numeric: tabular-nums; font-size: .8rem;
  padding: 0 .4rem; border-radius: 999px;
  background: var(--bg-inset); color: var(--text-muted);
}
.chip-active .chip-count { background: rgba(255,255,255,.22); color: inherit; }

.tabs { display: flex; gap: .25rem; border-bottom: 1px solid var(--border); margin-bottom: 1.5rem; flex-wrap: wrap; }
.tabs a {
  padding: .6rem .9rem; text-decoration: none; color: var(--text-muted);
  font-weight: 600; font-size: .94rem; border-bottom: 2px solid transparent; margin-bottom: -1px;
}
.tabs a:hover { color: var(--text); }
.tabs a[aria-current="page"] { color: var(--accent); border-bottom-color: var(--accent); }

@media (max-width: 640px) {
  .site-header .wrap { height: auto; padding-top: .7rem; padding-bottom: .7rem; flex-wrap: wrap; }
  .site-nav { width: 100%; margin-left: 0; }
  .hero { padding: 2.5rem 0 2rem; }
  section { margin: 2.5rem 0; }
  .card { padding: 1.15rem; }
  th, td { padding: .55rem .6rem; }
}

@media print {
  .site-header, .site-footer, .no-print { display: none !important; }
  body { background: #fff; color: #000; }
  .card { border: 1px solid #ccc; box-shadow: none; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
`.trim();

export default STYLES;
