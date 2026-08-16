# Curbcut — founder brief

## The opportunity

Web accessibility is a market where **the customer already has the problem, already knows it, and is
already spending money.** That combination is rare and it is the reason this was chosen over the
alternatives considered (AI search-visibility monitoring, PCI DSS client-side script compliance,
healthcare denial management, government bid discovery).

Three forcing functions, all verified against primary sources:

1. **Litigation.** 3,117 website accessibility lawsuits were filed in US federal court in 2025 — up
   27% year over year, and 36% of all ADA Title III filings. New York (1,021), Florida (961) and
   Illinois (585) dominate. Federal filings are the visible minority; most matters are demand letters
   that settle quietly. *(Seyfarth Shaw ADA Title III filing analysis.)*
2. **The European Accessibility Act.** Directive (EU) 2019/882 applies to services provided to
   consumers after **28 June 2025**, covering e-commerce, consumer banking, e-books, transport and
   telecoms — including non-EU companies selling into the EU. Microenterprises providing services are
   exempt under Article 4(5), which conveniently excludes the segment least able to pay.
3. **ADA Title II.** US state and local government must meet WCAG 2.1 AA by **26 April 2027**
   (population ≥50,000) and **26 April 2028** (smaller entities and special districts). Governments
   must also ensure their *contractors* conform — which pulls every vendor selling to the public
   sector into scope.

Note on timing: the large-entity deadline was extended from 2026 to 2027 by a DOJ interim final rule
published 20 April 2026. Deadline-panic messaging has therefore lost its edge for Title II; the durable
demand drivers are litigation and EAA.

## Why the gap is real

The market offers three unsatisfying options:

| Approach | Price | Failure mode |
|---|---|---|
| Overlay widgets (accessiBe, UserWay) | $490–$3,990/yr | Patches the page at runtime; source stays broken; rejected by the disability community |
| Scanners (Pope Tech $25–$400/mo, Deque, Siteimprove, Level Access) | $25–$400/mo → enterprise | Produce a backlog nobody works through |
| Audit consultancies | $5,000–$50,000 | Correct, unscalable, stale on the next deploy |

**Nobody automates the fix or the proof.** Finding issues is commoditised. Fixing them and evidencing
the fix is where the unmet demand and the pricing power sit.

There is also a live arbitrage: thousands of businesses already pay $500–$4,000/yr for overlays that
do not repair their code. That is a pre-qualified, addressable migration list with a demonstrated
willingness to pay at exactly our price point.

## Customer

Primary wedge: **mid-market e-commerce and B2B SaaS, 20–500 employees, with an in-house or contracted
dev team.** They have a real codebase, they ship continuously, they sell to enterprise or EU
consumers, and they are too big to ignore risk but too small for a $50k audit cycle.

Buyer varies by trigger: engineering lead (CI/quality), Head of Legal or Ops (demand letter), or
Sales/RevOps (a blocked deal waiting on a VPAT).

Secondary: **digital agencies** managing 10–100 client sites — a natural multi-site, high-retention
account, and a referral engine.

## Value proposition

> Scanners give you a backlog. Consultants give you a PDF. Curbcut gives you the diff — and the dated
> proof that you shipped it.

## Business model

| Plan | Price | Wedge |
|---|---|---|
| Free | $0 | 1 site, 25 pages, full report, no fixes — acquisition, not service |
| Starter | $79/mo | 1 site, 250 pages, code patches, accessibility statement |
| **Growth** | **$249/mo** | 5 sites, 2,500 pages, VPAT/ACR, API + CI gating |
| Scale | $749/mo | 25 sites, agencies, per-client evidence packs |
| Human-verified audit | From $2,500 | Services attach on top of software data |
| Done-for-you remediation | From $4,500 | We write the fixes and ship them as pull requests |
| Compliance retainer | From $1,500/mo | Recurring services revenue alongside the software |

The free/paid boundary is deliberate: **seeing the problem is free, fixing and proving it is paid.**
That maximises top-of-funnel while keeping the thing customers actually value behind the wall.

Expansion revenue: more sites, more pages, more seats, more evidence documents, then the audit
attach. Agencies expand fastest and churn least.

Path to scale: $10k MRR ≈ 40 Growth accounts. $100k MRR ≈ 400 accounts at ~$250 blended. $1M MRR
requires ~2,000 accounts at ~$500 blended — reachable with agency and enterprise mix in a market with
millions of in-scope sites and thousands of new lawsuits every year.

## Distribution

Ranked by expected efficiency:

1. **SEO + the free scanner.** "ADA compliance", "WCAG 2.1 AA", "what is a VPAT", "accessibility
   statement" carry high commercial intent. Four guides ship at launch. The no-signup scanner converts
   traffic into a score, a fear, and an email — the entire funnel is instrumented.
2. **Litigation-triggered outbound.** Federal ADA filings are public record. That is a continuously
   refreshed list of companies with an acute, budgeted, time-sensitive problem. Send them their own
   scan report. This is the highest-intent cold outreach available in any market.
3. **Procurement-triggered.** Companies publicly requesting VPATs from vendors reveal both sides of a
   transaction we can serve.
4. **Agency partnerships.** White-label reporting; agencies resell remediation as a retainer.
5. **Developer channel.** CLI, API and CI gating; the CLI exits non-zero on violations.
6. **Overlay migration.** Overlay scripts are detectable on any site. That is a targetable list of
   businesses already paying for an inferior product.

## Moat

"AI" is not a moat. These are:

- **The ledger.** Switching vendors forfeits your remediation history — the dated evidence of a
  good-faith programme that matters most precisely when you are under legal pressure.
- **Workflow lock-in.** Once CI fails builds on new violations, we are infrastructure, not a dashboard.
- **Proprietary correction data.** Every accepted, rejected and edited fix is a labeled example.
  Nobody else is accumulating violation→accepted-fix pairs at scale; this compounds into better
  automated remediation.
- **Evidence continuity.** VPAT version history and statements are cited in contracts.
- **Trust.** In a category defined by overvaluing automation, being the vendor that publishes what it
  cannot test is a durable brand position — and it is why the "Not Evaluated" label appears everywhere.

## The strategic bet on honesty

Automated tools can fully verify only 2 of the 50 WCAG 2.1 A/AA criteria and partially verify 25. The
other 23 need a human. Curbcut says so on the landing page, in every report, and in every generated
document. This is not modesty:

- It is the legally safe position. An ACR is a representation a buyer may rely on.
- It differentiates against a category that overclaims.
- It **creates** the services upsell: showing exactly which 23 criteria need review is the natural
  lead-in to a $2,500–$7,500 human-verified audit.

## What would kill this

- **False positives.** A wrong finding destroys trust faster than a missed one earns it. Mitigated by
  the confidence system and a false-positive regression suite. One such bug was found and fixed during
  development by scanning w3.org.
- **Client-rendered sites.** Static analysis under-covers SPAs. Headless browser rendering is the
  single most important post-launch investment.
- **Deque or Level Access moving down-market.** Their enterprise sales motion and pricing opacity make
  this slow, but it is the real competitive risk.
- **Commoditisation of scanning.** Already true — which is exactly why the product is built around fix
  generation and evidence rather than detection.
