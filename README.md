# Curbcut

**Find it, fix it, prove it.** Accessibility remediation and conformance evidence for teams that ship.

Curbcut crawls a site, tests every page against WCAG 2.1 Level A and AA, generates ready-to-merge
code patches for the mechanical failures, tracks every issue from first detection to confirmed
resolution, and turns that history into the evidence documents that buyers and lawyers ask for.

It never claims a site is "compliant", and it never invents alt text.

---

## Why this exists

A team facing an accessibility deadline currently chooses between three bad options:

| | Cost | What you get |
|---|---|---|
| Overlay widget | $490–$3,990/yr | A runtime patch; your code stays broken |
| Scanner | $25–$400/mo | A 400-item backlog and no fix |
| Manual audit | $5,000–$50,000 | Real fixes, stale on your next deploy |

Curbcut closes the gap between the scanner and the audit: it finds the issue, writes the fix, verifies
it on the next scan, and keeps the dated record.

---

## Quick start

Requires **Node.js 22.5+** (uses the built-in `node:sqlite`). No database server, no Docker.

```bash
npm install
npm test          # 132 tests
npm run seed      # creates a demo account
npm start         # http://localhost:3300
```

The seed command prints demo credentials (default `founder@curbcut.dev` / `curbcut-demo-2026`).

### Scan something from the terminal

```bash
npm run scan -- https://example.com
npm run scan -- https://example.com --fix     # show the generated patch
npm run scan -- https://example.com --json    # machine-readable; exits 1 on confirmed failures
```

The CLI exits non-zero when confirmed violations are found, so it drops straight into CI.

---

## What is built

**Scanning engine** — 67 rules mapped to real WCAG 2.1 success criteria, plus Section 508 references,
covering 54% of Level A/AA criteria at least partially. Spec-compliant HTML parsing (parse5) with
byte-level source positions. A small CSS cascade engine resolves text contrast from real stylesheets,
including linked ones.

**Three confidence tiers** — `confirmed` (machine-verifiable failure), `needs review` (a human
decision), and `advisory` (a real best-practice issue that never affects the score and never enters a
conformance document). Being thorough means surfacing more real issues, never inventing one.

**Deep crawling** — sitemap.xml and sitemap-index discovery, robots.txt `Sitemap:` directives, and
template-aware prioritization that favors unseen page shapes over the hundredth product page.

**Headless rendering (optional)** — with Playwright installed, pages are driven in a real Chromium:
JavaScript runs, and colors, font sizes and element geometry are *measured* rather than inferred. That
turns three previously untestable things into hard findings — contrast behind CSS variables, touch
targets under 24×24px, and layouts that force horizontal scrolling — and makes client-rendered
applications scannable at all. Without Playwright the product behaves exactly as before.

**Live scan view** — Server-Sent Events stream every fetch, parse and finding as it happens, with a
running activity log. Works without JavaScript via a server-rendered snapshot and meta-refresh.

**Honesty by construction** — every finding is graded `definite` (machine-verifiable) or `review`
(needs a human). Pages that render client-side are reported as partially covered rather than
misleadingly clean. Colors that come from CSS variables or gradients are skipped, never guessed.

**Fix generation** — findings carry exact source offsets, so patches are real text edits presented as
a unified diff. Only additive or restrictive changes are automated. Alt text is never written by the
machine.

**The ledger** — each distinct issue gets a stable identity that survives content edits. It records
first-seen, resolved, and regression events. This is the switching cost and the raw material for
evidence.

**Evidence documents** — accessibility statement (EAA), VPAT 2.5 / ACR draft, and a dated remediation
record. Versioned and content-hashed.

**SaaS platform** — accounts, orgs, sessions, scrypt password hashing, CSRF, plan limits, Stripe
billing (degrades to local mode without keys), REST API with hashed API keys, first-party analytics,
audit log, admin dashboard.

**Account lifecycle** — self-service password reset (hashed single-use tokens that destroy every
session on use), team invitations with seat limits and role assignment, and an email layer that
records every message to an outbox whether or not a provider is configured.

**Scheduled scans** — per-site cadence gated by plan (weekly on Starter, daily on Growth, six-hourly
on Scale), with notification email that only fires when something actually changed. An expired trial
or downgraded plan silently drops the site back to manual rather than consuming quota.

**Managed services** — three tiers (human-verified audit, done-for-you remediation, ongoing retainer)
with a request flow and an admin pipeline to work them. Only 2 of the 50 WCAG A/AA criteria are fully
verifiable by software, so nearly every criterion still needs some human judgment; services are how
that gap gets closed and how the highest-value deals land.

**Admin panel** — MRR and funnel, account list with drill-down into users, sites, scans and activity,
the service pipeline, and a lead list of anonymous scans ranked worst-score-first.

**Marketing surface** — landing page with a no-signup scanner, pricing, services, four SEO guides,
docs, API reference, legal pages.

---

## Architecture

```
src/
  server.js              HTTP server, router, security headers, rate limiting
  api.js                 REST API (bearer auth)
  auth.js                scrypt passwords, sessions, CSRF, API keys
  billing.js             Stripe via REST; local mode when unconfigured
  plans.js               plan definitions, limits, upgrade prompts
  analytics.js           first-party events, audit log, funnel metrics
  db.js                  node:sqlite, append-only migrations
  lib/
    html.js              parse5 wrapper, accessible-name computation
    css.js               minimal cascade for contrast resolution
    color.js             WCAG contrast math
  services.js            managed service tiers and request pipeline
  scan/
    rules.js             the core WCAG rule set
    rules-advanced.js    keyboard, ARIA integrity, forms, structure, media
    engine.js            rule execution, scoring, coverage detection
    crawler.js           SSRF-safe fetching, robots.txt, sitemap, prioritization
    fixer.js             source patching and unified diffs
    runner.js            orchestration and ledger reconciliation
    progress.js          in-process event bus for the live scan view
  evidence/
    wcag.js              WCAG 2.1 A/AA criteria + automatability
    documents.js         statement, VPAT, remediation record
  web/                   server-rendered pages, auto-escaping templates
```

**Dependencies: one required, one optional.** `parse5` is required, because HTML parsing must be
spec-correct. `playwright` is optional — it unlocks headless rendering, and its absence only reduces
coverage, never breaks the product. Everything else uses Node built-ins, which keeps the supply chain
auditable for compliance buyers.

```bash
npm install playwright && npx playwright install chromium   # optional, ~95MB
```

Set `RENDER_MODE=static` to force plain fetching even when Playwright is present (the test suite does
this so results stay deterministic).

**Almost no client-side JavaScript.** The app is server-rendered semantic HTML. One small same-origin
script drives the live scan view; every page works with JavaScript disabled. The CSP allows
`script-src 'self'` and nothing inline.

---

## Dogfooding

Every public page of this application scores **100/100 with zero findings** against Curbcut's own
scanner:

```bash
npm start
npm run scan -- http://127.0.0.1:3300/
```

Two real bugs were found this way during development: a skipped heading level in our footer, and a
false positive where an icon button labeled by a nested `<svg aria-label>` was wrongly reported as
unnamed (found by scanning `w3.org/WAI`). Both are now covered by regression tests.

---

## Configuration

Copy `.env.example` to `.env`. Everything has a working default except in production.

| Variable | Purpose |
|---|---|
| `PORT`, `HOST`, `APP_URL` | Where the server runs |
| `DATABASE_PATH` | SQLite file (default `./data/curbcut.db`) |
| `SESSION_SECRET` | **Required in production.** `openssl rand -hex 32` |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Enables real checkout |
| `STRIPE_PRICE_STARTER/GROWTH/SCALE` | Stripe price IDs per plan |
| `ANTHROPIC_API_KEY` | Optional; enhances fix suggestions. Never required for correctness |
| `CRAWLER_CONCURRENCY`, `CRAWLER_DELAY_MS` | Crawl politeness |
| `RENDER_MODE` | `auto` (browser when available), `static`, or `browser` |
| `EMAIL_PROVIDER`, `EMAIL_API_KEY`, `EMAIL_FROM` | Resend or Postmark; unset logs to the outbox instead |
| `SCHEDULER_ENABLED`, `SCHEDULER_INTERVAL_MS` | Recurring scan loop |

---

## Deployment

Runs anywhere Node runs. A single process with a mounted volume for the SQLite file is sufficient to
serve early customers.

```bash
NODE_ENV=production \
SESSION_SECRET=$(openssl rand -hex 32) \
DATABASE_PATH=/data/curbcut.db \
APP_URL=https://curbcut.dev \
npm start
```

Put TLS in front (Caddy, nginx, or a platform load balancer). `GET /healthz` is the health check.
`SIGTERM` drains connections.

**Stripe webhook:** point `https://your-domain/webhooks/stripe` at the endpoint and set
`STRIPE_WEBHOOK_SECRET`. Signatures are verified against the raw body with a five-minute replay window.

**When to leave SQLite:** it comfortably handles thousands of sites. Move to Postgres when you need
multiple app servers or scan workers; `src/db.js` is the only module with SQL bindings, and scans
already run out of band.

---

## Security

- SSRF protection on every user-supplied URL: DNS resolution checked against private ranges, cloud
  metadata endpoints and loopback, re-validated on every redirect hop.
- Response size caps and streaming reads so a hostile page cannot exhaust memory.
- scrypt password hashing; constant-time comparison; timing-equalised login.
- HMAC CSRF tokens derived from the session, so they expire with it.
- Auto-escaping templates — the safe path is the default.
- CSP with `script-src 'none'`, plus `nosniff`, `DENY` framing, and HSTS in production.
- API keys stored as SHA-256 hashes and shown exactly once.

Run `npm test` to exercise the security assertions; SSRF, CSRF and injection cases are covered.

---

## Testing

```bash
npm test
```

132 tests across six suites:

- `engine.test.js` — rules, contrast math, CSS cascade, accessible names, false-positive guards
- `fixer.test.js` — patch generation, diffing, injection safety, crawler safety
- `ledger.test.js` — resolution and regression transitions, crawl-coverage safety, evidence generation
- `e2e.test.js` — boots the real server and walks the full customer path
- `render.test.js` — proves headless rendering finds what static analysis provably cannot
- `accounts.test.js` — password reset, invitations, email outbox, scheduled scans

Two tests matter most. One asserts that **applying our patches to a broken page and rescanning
produces fewer violations and introduces none**. The other asserts that **a page which was not
crawled never has its issues marked resolved** — without it, varying crawl coverage would write
fabricated fix dates into documents sold as legal evidence.

---

## License

Proprietary. All rights reserved.
