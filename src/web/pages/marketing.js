import { html, raw } from '../html.js';
import { page, scoreRing, impactBadge, confidenceBadge, alert, BRAND } from '../layout.js';
import { PLANS, PLAN_ORDER } from '../../plans.js';
import { coverageStats } from '../../evidence/wcag.js';

const coverage = coverageStats();

/* ------------------------------------------------------------------ *
 * Landing page
 * ------------------------------------------------------------------ */

export function landingPage(ctx, { error = null, url = '' } = {}) {
  const body = html`
    <div class="wrap">
      <section class="hero">
        <p class="eyebrow">WCAG 2.1 AA · Section 508 · European Accessibility Act</p>
        <h1>Your accessibility report is a to-do list. Ours is a pull request.</h1>
        <p class="lede">
          Scanners hand you 400 violations and walk away. Curbcut finds the failures, writes the
          code that fixes them, verifies the fix on the next scan, and keeps the dated evidence
          your buyers and your lawyers ask for.
        </p>

        <div class="scan-box">
          <form class="scan-form" method="post" action="/scan">
            <label for="scan-url" class="visually-hidden">Website address to scan</label>
            <input type="url" id="scan-url" name="url" required
                   placeholder="https://yourcompany.com"
                   value="${url}"
                   autocomplete="url" inputmode="url"
                   aria-describedby="scan-help">
            <button type="submit" class="btn btn-primary btn-lg">Run a free scan</button>
          </form>
          <p id="scan-help" class="small muted tight" style="margin-top:.6rem">
            No signup, no credit card, no script to install. Results in about 20 seconds.
          </p>
          ${error ? alert('error', error) : ''}
        </div>
      </section>

      <section>
        <h2>The market gives you three bad options</h2>
        <p class="muted" style="max-width:62ch">
          Every team facing an accessibility deadline ends up choosing between an overlay that
          doesn't change their code, a scanner that produces a backlog nobody works through, or
          an audit that is out of date the day after it lands.
        </p>
        <div class="table-wrap card card-flush" style="margin-top:1.5rem">
          <table class="compare-table">
            <caption class="visually-hidden">Comparison of accessibility remediation approaches</caption>
            <thead>
              <tr>
                <th scope="col">&nbsp;</th>
                <th scope="col">Overlay widget</th>
                <th scope="col">Scanner</th>
                <th scope="col">Manual audit</th>
                <th scope="col">${BRAND.name}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Typical cost</td>
                <td>$490–$3,990/yr</td>
                <td>$25–$400/mo</td>
                <td>$5,000–$50,000</td>
                <td>$79–$749/mo</td>
              </tr>
              <tr>
                <td>Finds real issues</td>
                <td class="cross">Partly</td>
                <td class="check">Yes</td>
                <td class="check">Yes</td>
                <td class="check">Yes</td>
              </tr>
              <tr>
                <td>Fixes your source code</td>
                <td class="cross">No — patches at runtime</td>
                <td class="cross">No</td>
                <td class="cross">Recommends only</td>
                <td class="check">Yes — as a diff</td>
              </tr>
              <tr>
                <td>Re-verifies after you ship</td>
                <td class="cross">No</td>
                <td class="check">Yes</td>
                <td class="cross">Not without paying again</td>
                <td class="check">Yes</td>
              </tr>
              <tr>
                <td>Produces procurement evidence</td>
                <td class="cross">No</td>
                <td class="cross">No</td>
                <td class="check">Yes</td>
                <td class="check">Yes</td>
              </tr>
              <tr>
                <td>Honest about what it can't test</td>
                <td class="cross">No</td>
                <td class="cross">Rarely</td>
                <td class="check">Yes</td>
                <td class="check">Yes</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>How it works</h2>
        <div class="grid grid-3" style="margin-top:1.5rem">
          <div class="card">
            <p class="eyebrow">Step 1</p>
            <h3>Find</h3>
            <p class="muted small">
              We crawl your site and test every page against WCAG 2.1 Level A and AA. Each finding
              is mapped to the exact success criterion, the element that failed, and the line of
              source that produced it.
            </p>
          </div>
          <div class="card">
            <p class="eyebrow">Step 2</p>
            <h3>Fix</h3>
            <p class="muted small">
              For mechanical failures — missing language attributes, blocked zoom, unlabeled
              frames, broken tab order — we generate the patch. You review a diff and merge it.
              Judgment calls go to your team with specific guidance, never a guessed answer.
            </p>
          </div>
          <div class="card">
            <p class="eyebrow">Step 3</p>
            <h3>Prove</h3>
            <p class="muted small">
              Every issue is tracked from first detection to confirmed resolution. That ledger
              becomes your accessibility statement, your VPAT draft, and a dated remediation
              record you can hand to a buyer or to counsel.
            </p>
          </div>
        </div>
      </section>

      <section>
        <div class="card" style="background:var(--bg-subtle)">
          <h2>What we will not tell you</h2>
          <p style="max-width:64ch">
            We will never tell you your site is "compliant". No automated tool can determine that.
            Of the ${coverage.total} Level A and AA success criteria in WCAG 2.1,
            <strong>${coverage.full} can be fully verified by software and ${coverage.partial} can be
            partially verified</strong>. The remaining ${coverage.none} need a human, and often a
            person using a screen reader.
          </p>
          <p style="max-width:64ch" class="tight">
            Curbcut reports those criteria as "Not Evaluated" and says so in every document it
            generates. Anything else would be selling you a false sense of safety — which is
            exactly what leaves companies exposed when a demand letter arrives.
          </p>
        </div>
      </section>

      <section>
        <h2>Why this is urgent</h2>
        <div class="grid grid-3" style="margin-top:1.5rem">
          <div class="card stat">
            <p class="stat-value">3,117</p>
            <p class="stat-label">US federal website accessibility lawsuits filed in 2025, up 27% on 2024 and 36% of all ADA Title III filings.</p>
          </div>
          <div class="card stat">
            <p class="stat-value">28 June 2025</p>
            <p class="stat-label">The date from which the European Accessibility Act applies to e-commerce, banking, transport and e-book services sold to EU consumers.</p>
          </div>
          <div class="card stat">
            <p class="stat-value">26 April 2027</p>
            <p class="stat-label">The ADA Title II deadline for US state and local government entities serving 50,000 or more people, and for the vendors who supply them.</p>
          </div>
        </div>
        <p class="small muted" style="margin-top:1rem">
          Lawsuit figures from Seyfarth Shaw's ADA Title III federal filing analysis. EAA dates from
          Directive (EU) 2019/882; microenterprises providing services are exempt under Article 4(5).
          ADA Title II dates reflect the Department of Justice interim final rule published 20 April 2026.
        </p>
      </section>

      <section class="center">
        <h2>See your real numbers in 20 seconds</h2>
        <p class="muted">Scan any public page. No account required.</p>
        <form class="scan-form" method="post" action="/scan" style="max-width:520px;margin:1.5rem auto 0">
          <label for="scan-url-2" class="visually-hidden">Website address to scan</label>
          <input type="url" id="scan-url-2" name="url" required placeholder="https://yourcompany.com" autocomplete="url">
          <button type="submit" class="btn btn-primary btn-lg">Run a free scan</button>
        </form>
      </section>
    </div>
  `;

  return page({
    title: null,
    description: BRAND.description,
    body,
    ctx,
  });
}

/* ------------------------------------------------------------------ *
 * Public scan result — the conversion moment
 * ------------------------------------------------------------------ */

export function publicScanResultPage(ctx, { result, scanId, url, emailCaptured = false }) {
  const definite = result.findings.filter((f) => f.confidence === 'definite');
  const review = result.findings.filter((f) => f.confidence === 'review');
  const advisory = result.findings.filter((f) => f.confidence === 'advisory');

  const grouped = new Map();
  for (const finding of result.findings) {
    if (!grouped.has(finding.ruleId)) grouped.set(finding.ruleId, []);
    grouped.get(finding.ruleId).push(finding);
  }
  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const groups = [...grouped.entries()]
    .map(([ruleId, items]) => ({ ruleId, items, ...items[0] }))
    .sort((a, b) => order[a.impact] - order[b.impact] || b.items.length - a.items.length);

  const shown = groups.slice(0, 3);
  const hidden = groups.slice(3);
  const hiddenCount = hidden.reduce((sum, g) => sum + g.items.length, 0);

  const body = html`
    <div class="wrap" style="padding-top:2.5rem">
      <p class="small muted"><a href="/">← Scan another site</a></p>

      <div class="card" style="margin-bottom:1.5rem">
        <div class="row-between">
          <div class="row" style="gap:1.25rem">
            ${scoreRing(result.score)}
            <div>
              <h1 style="margin-bottom:.25rem">Accessibility score: ${result.score}/100</h1>
              <p class="muted tight" style="overflow-wrap:anywhere">${url}</p>
              <div class="row" style="margin-top:.6rem">
                <span class="badge badge-critical">${String(definite.length)} confirmed ${definite.length === 1 ? 'failure' : 'failures'}</span>
                <span class="badge badge-outline">${String(review.length)} need review</span>
                ${advisory.length
                  ? html`<span class="badge badge-outline">${String(advisory.length)} recommendations</span>`
                  : ''}
                ${result.stats.elements
                  ? html`<span class="badge badge-outline">${String(result.stats.elements)} elements checked</span>`
                  : ''}
              </div>
            </div>
          </div>
          <a class="btn btn-primary btn-lg" href="/signup?url=${encodeURIComponent(url)}">Get the fixes</a>
        </div>
      </div>

      ${!result.coverage.complete
        ? alert('warn', `${result.coverage.note}`)
        : ''}

      ${result.findings.length === 0
        ? html`
          <div class="card">
            <h2>No automated failures detected on this page</h2>
            <p class="muted">
              That is a genuinely good result — most pages we scan have between 20 and 200. It does
              not mean the page is compliant: ${String(coverage.none)} of the ${String(coverage.total)} WCAG
              2.1 A/AA criteria cannot be tested by software at all.
            </p>
            <a class="btn btn-primary" href="/signup?url=${encodeURIComponent(url)}">Scan the whole site</a>
          </div>`
        : html`
          <h2>What we found</h2>
          ${shown.map((group) => html`
            <details class="finding" open>
              <summary>
                ${impactBadge(group.impact)}
                ${group.title}
                <span class="muted small">${String(group.items.length)} ${group.items.length === 1 ? 'instance' : 'instances'}</span>
                ${confidenceBadge(group.confidence)}
              </summary>
              <div class="finding-body">
                <p class="small">${group.why}</p>
                <p class="small muted">
                  WCAG ${group.wcag.join(', ')} (Level ${group.level})
                </p>
                ${group.items.slice(0, 3).map((item) => html`
                  <div class="occurrence">
                    <div>${item.message}</div>
                    <code>${item.snippet}</code>
                    <div class="small muted" style="margin-top:.3rem">
                      Line ${String(item.line ?? '—')} · <span class="mono">${item.selector}</span>
                    </div>
                  </div>
                `)}
                ${group.items.length > 3
                  ? html`<p class="small muted">…and ${String(group.items.length - 3)} more of this type.</p>`
                  : ''}
              </div>
            </details>
          `)}

          ${hidden.length
            ? html`
              <div class="card center" style="margin-top:1.5rem;background:var(--bg-subtle)">
                <h3>${String(hiddenCount)} more issues across ${String(hidden.length)} other categories</h3>
                <p class="muted" style="max-width:52ch;margin-inline:auto">
                  Create a free account to see every issue on this page, scan your whole site, and
                  get the code patches that fix the mechanical failures.
                </p>
                <div class="row" style="justify-content:center;margin-top:1rem">
                  <a class="btn btn-primary btn-lg" href="/signup?url=${encodeURIComponent(url)}">See all issues free</a>
                </div>
                <p class="small muted" style="margin-top:.75rem">
                  Hidden categories: ${hidden.slice(0, 6).map((g) => g.title).join(' · ')}${hidden.length > 6 ? ' …' : ''}
                </p>
              </div>`
            : ''}
        `}

      <div class="card" style="margin-top:1.5rem">
        <h3>Email me this report</h3>
        ${emailCaptured
          ? alert('success', 'On its way. The link in the email stays live, so you can come back to it.')
          : html`
            <form method="post" action="/scan/${scanId}/email" class="scan-form">
              <label for="lead-email" class="visually-hidden">Email address</label>
              <input type="email" id="lead-email" name="email" required placeholder="you@company.com" autocomplete="email">
              <button type="submit" class="btn btn-secondary">Send me the report</button>
            </form>
            <p class="small muted" style="margin-top:.5rem">
              We'll send this report to your inbox. No marketing sequence, and you can bookmark this
              page to return to it directly.
            </p>`}
      </div>
    </div>
  `;

  return page({
    title: `Accessibility scan: ${result.score}/100`,
    description: `Automated WCAG 2.1 AA scan results for ${url}.`,
    body,
    ctx,
    // These pages document third-party sites' accessibility failures. Keeping
    // them out of search results avoids building a directory that plaintiff
    // firms could mine, and avoids publishing findings about sites we do not
    // have a relationship with.
    head: '<meta name="robots" content="noindex, nofollow">',
  });
}

/* ------------------------------------------------------------------ *
 * Pricing
 * ------------------------------------------------------------------ */

export function pricingPage(ctx) {
  const body = html`
    <div class="wrap">
      <section class="center" style="margin-bottom:2rem">
        <h1>Pricing</h1>
        <p class="muted" style="max-width:56ch;margin-inline:auto">
          Less than a single hour of legal defense. Every paid plan includes code-level fixes and
          the evidence documents that buyers ask for.
        </p>
      </section>

      <div class="price-grid">
        ${PLAN_ORDER.map((planId) => {
          const plan = PLANS[planId];
          return html`
            <div class="card price-card ${plan.popular ? 'popular' : ''}">
              ${plan.popular ? html`<span class="popular-flag">Most popular</span>` : ''}
              <h2 style="font-size:1.2rem">${plan.name}</h2>
              <p class="price-tag">${plan.priceLabel}<span class="muted" style="font-size:.9rem;font-weight:400"> ${plan.cadence === 'forever' ? '' : `/ ${plan.cadence.replace('per ', '')}`}</span></p>
              <p class="small muted">${plan.tagline}</p>
              <ul>
                ${plan.highlights.map((item) => html`<li>${item}</li>`)}
                ${(plan.missing || []).map((item) => html`<li class="no">${item}</li>`)}
              </ul>
              <a class="btn ${plan.popular ? 'btn-primary' : 'btn-secondary'}"
                 href="${ctx.user ? `/app/settings/billing?plan=${plan.id}` : `/signup?plan=${plan.id}`}">
                ${plan.id === 'free' ? 'Start free' : `Choose ${plan.name}`}
              </a>
            </div>
          `;
        })}
      </div>

      <section>
        <div class="card">
          <h2>Need a signed conformance report?</h2>
          <p style="max-width:64ch">
            Automated testing covers ${coverage.testedPercent}% of WCAG 2.1 A/AA criteria at least partially.
            For a complete Accessibility Conformance Report — the kind a government buyer or enterprise
            procurement team will accept — the remaining criteria need a qualified human reviewer.
          </p>
          <p style="max-width:64ch">
            We offer three managed tiers: a <strong>human-verified audit</strong> from $2,500,
            <strong>done-for-you remediation</strong> from $4,500 where we write the fixes and deliver
            them as pull requests, and an <strong>ongoing compliance retainer</strong> from $1,500 a month.
            Our reviewers start from your Curbcut data, so they spend their time on the criteria software
            cannot judge rather than re-finding what the scanner already found — which is why this costs a
            fraction of a $5,000–$50,000 audit that starts from a blank page.
          </p>
          <a class="btn btn-secondary" href="/services">See done-for-you services</a>
        </div>
      </section>

      <section>
        <h2>Questions</h2>
        <div class="stack">
          <div class="card">
            <h3>Do you install a script on my site?</h3>
            <p class="muted tight">No. Curbcut never adds anything to your site. We read your pages the same
            way a browser does and give you changes to make in your own codebase. Overlay widgets that
            patch your page at runtime leave the underlying code broken and are widely rejected by the
            disability community.</p>
          </div>
          <div class="card">
            <h3>Will this make me compliant?</h3>
            <p class="muted tight">No tool can promise that, and you should distrust any vendor that does.
            Curbcut eliminates the machine-detectable failures — which is the large majority of what
            appears in demand letters — and tells you precisely which criteria still need human review.</p>
          </div>
          <div class="card">
            <h3>What happens to my data if I cancel?</h3>
            <p class="muted tight">Your scan history and evidence documents remain available on the free
            plan. We never hold your remediation record hostage.</p>
          </div>
          <div class="card">
            <h3>Can I scan a staging site behind a login?</h3>
            <p class="muted tight">Public URLs work today. Authenticated crawling is on the roadmap and
            available on Scale by arrangement.</p>
          </div>
        </div>
      </section>
    </div>
  `;

  return page({ title: 'Pricing', description: 'Curbcut pricing — accessibility remediation and conformance evidence from $79/month.', body, ctx });
}

/* ------------------------------------------------------------------ *
 * How it works
 * ------------------------------------------------------------------ */

export function howItWorksPage(ctx) {
  const body = html`
    <div class="wrap-narrow" style="padding-top:2.5rem">
      <h1>How Curbcut works</h1>
      <p class="lede muted">From a URL to a merged pull request and a dated evidence trail.</p>

      <h2>1. We read your pages the way a browser does</h2>
      <p>Give us a URL. We crawl same-origin pages, respect your <code>robots.txt</code>, and fetch your
      stylesheets so we can evaluate real rendered color contrast rather than guessing. Parsing uses a
      spec-compliant HTML parser, and every finding records the exact byte offset of the element that
      caused it.</p>

      <h2>2. Every finding is graded by confidence</h2>
      <p>A missing <code>lang</code> attribute is a fact. Whether a heading level is "wrong" is a
      judgment. Curbcut separates the two:</p>
      <ul>
        <li><strong>Confirmed</strong> — machine-verifiable failures. These count fully against your score.</li>
        <li><strong>Needs review</strong> — strong signals that require a person to decide. These are
        weighted lower, and never presented as proven failures.</li>
      </ul>

      <h2>3. Mechanical failures become a diff</h2>
      <p>Where a fix is purely additive or restrictive and cannot change how your page behaves, we generate
      the patch:</p>
      <pre><code>--- a/index.html
+++ b/index.html
@@ -1,4 +1,4 @@
-&lt;html&gt;
+&lt;html lang="en"&gt;
-&lt;meta name="viewport" content="width=device-width, user-scalable=no"&gt;
+&lt;meta name="viewport" content="width=device-width"&gt;</code></pre>
      <p>We will not write your alt text. Describing an image requires knowing what it means in context,
      and a plausible-sounding guess is worse than a blank, because it silently defeats review. Those
      findings are routed to a human with specific guidance instead.</p>

      <h2>4. The next scan proves the fix</h2>
      <p>Each distinct issue gets a stable identity that survives content edits. When it stops appearing,
      it is marked resolved with a timestamp. If it comes back, it reopens as a regression. That record —
      first detected, resolved, by whom — is the ledger.</p>

      <h2>5. The ledger becomes your evidence</h2>
      <p>From that history Curbcut generates three documents:</p>
      <ul>
        <li><strong>An accessibility statement</strong> — the public statement of conformance the European
        Accessibility Act expects, and the first thing a plaintiff's firm checks for.</li>
        <li><strong>A VPAT 2.5 / ACR draft</strong> — the report enterprise and public-sector buyers request
        during procurement, with automatable criteria prefilled and the rest honestly marked.</li>
        <li><strong>A remediation record</strong> — dated proof of an ongoing, good-faith programme.</li>
      </ul>

      <div class="card" style="background:var(--bg-subtle);margin-top:2rem">
        <h3>What we cannot do</h3>
        <p class="tight">Software cannot judge whether your alt text is meaningful, whether your focus order
        makes sense to a human, whether an error message is actually helpful, or whether a video's audio
        description conveys what matters. ${coverage.none} of the ${coverage.total} WCAG 2.1 A/AA criteria fall
        into that category. We label them "Not Evaluated" everywhere they appear.</p>
      </div>

      <p style="margin-top:2rem"><a class="btn btn-primary btn-lg" href="/">Scan your site free</a></p>
    </div>
  `;
  return page({ title: 'How it works', description: 'How Curbcut finds, fixes and proves web accessibility compliance.', body, ctx });
}

/* ------------------------------------------------------------------ *
 * SEO guides — the organic acquisition surface
 * ------------------------------------------------------------------ */

const GUIDES = {
  'ada-compliance': {
    title: 'ADA web accessibility: what US businesses actually need to know',
    description: 'Who the ADA applies to online, what the courts have actually held, and what to do about demand letters.',
    body: html`
      <h2>The short version</h2>
      <p>The Americans with Disabilities Act does not mention websites — it was written in 1990. Courts have
      spent three decades deciding how it applies to them, and the practical answer today is: if you are a
      business open to the public (Title III) or a state or local government (Title II), your website is in scope.</p>

      <h2>The litigation picture</h2>
      <p>In 2025, <strong>3,117 website accessibility lawsuits</strong> were filed in US federal court, a 27%
      increase on 2024, making up 36% of all ADA Title III filings. New York (1,021), Florida (961) and
      Illinois (585) accounted for most of them. These figures come from Seyfarth Shaw's annual analysis of
      federal filings.</p>
      <p>Federal lawsuits are the visible tip. Most matters begin and end with a demand letter that never
      reaches a docket, typically seeking a five-figure settlement plus a commitment to remediate.</p>

      <h2>What standard applies</h2>
      <p>There is no general web accessibility regulation for private businesses in the US. In practice,
      courts, settlements and consent decrees converge on <strong>WCAG 2.1 Level AA</strong>. For state and
      local government, the Department of Justice made this explicit in its 2024 Title II rule.</p>

      <h2>ADA Title II deadlines</h2>
      <p>Public entities must meet WCAG 2.1 AA by:</p>
      <ul>
        <li><strong>26 April 2027</strong> — entities serving 50,000 or more people (extended from 2026 by an
        interim final rule published 20 April 2026)</li>
        <li><strong>26 April 2028</strong> — entities serving fewer than 50,000, and special district governments</li>
      </ul>
      <p>This reaches further than it first appears: governments must also ensure their <em>contractors</em>
      meet the standard when delivering services on their behalf. If you sell software to a city, a school
      district or a transit agency, this is your deadline too.</p>

      <h2>What actually reduces risk</h2>
      <ol>
        <li>Eliminate the machine-detectable failures. Missing alt text, unlabeled form fields and unnamed
        controls are what automated plaintiff tooling finds first.</li>
        <li>Publish an accessibility statement with a working contact route.</li>
        <li>Keep dated evidence of ongoing remediation. Demonstrating a good-faith programme materially
        changes settlement conversations.</li>
        <li>Do not rely on an overlay widget. Overlays do not change your code, and their presence has not
        prevented suits.</li>
      </ol>
      <p class="small muted">This is general information, not legal advice. Talk to counsel about your situation.</p>
    `,
  },

  'european-accessibility-act': {
    title: 'The European Accessibility Act: who it covers and what it requires',
    description: 'EAA scope, the 28 June 2025 application date, the microenterprise exemption, and what non-EU companies need to know.',
    body: html`
      <h2>What it is</h2>
      <p>Directive (EU) 2019/882, the European Accessibility Act, harmonizes accessibility requirements for
      specific products and services across the EU single market. Member States were required to transpose it
      into national law by June 2022, and its requirements <strong>apply to services provided to consumers
      after 28 June 2025</strong>.</p>

      <h2>What it covers</h2>
      <p>The EAA is scoped to categories, not to all websites:</p>
      <ul>
        <li>E-commerce services</li>
        <li>Consumer banking services</li>
        <li>E-books and dedicated software</li>
        <li>Passenger transport services (air, bus, rail, waterborne)</li>
        <li>Telephony and audiovisual media access services</li>
        <li>Computing hardware, operating systems, ATMs, ticketing and check-in machines</li>
      </ul>

      <h2>The microenterprise exemption</h2>
      <p>Article 4(5) exempts microenterprises that provide services — generally, businesses with fewer than
      10 staff and turnover or balance sheet total not exceeding €2 million. Note the asymmetry: the exemption
      covers microenterprises providing <em>services</em>, and does not extend equally to those placing
      <em>products</em> on the market.</p>

      <h2>Does it apply to non-EU companies?</h2>
      <p>Yes, in effect. The obligation attaches to placing products or providing services on the EU market,
      not to where the company is incorporated. A US e-commerce business selling to consumers in the EU is
      generally in scope.</p>

      <h2>The technical standard</h2>
      <p>The EAA sets functional requirements rather than naming WCAG directly. In practice conformance is
      demonstrated against <strong>EN 301 549</strong>, the harmonized European standard, which incorporates
      WCAG 2.1 Level AA for web content.</p>

      <h2>What enforcement looks like</h2>
      <p>Enforcement is national: each Member State designates authorities and sets its own penalties, which
      vary considerably. Most regimes are complaint-driven, with authorities able to require remediation and
      levy fines. Practically, the first thing you are asked for is your accessibility statement.</p>
    `,
  },

  vpat: {
    title: 'What is a VPAT, and when do you actually need one?',
    description: 'VPAT and ACR explained: what buyers want, what the sections mean, and how to produce one honestly.',
    body: html`
      <h2>VPAT vs ACR</h2>
      <p>A <strong>VPAT</strong> (Voluntary Product Accessibility Template) is the blank template, published by
      the Information Technology Industry Council. Once you fill it in, the completed document is properly
      called an <strong>ACR</strong> — an Accessibility Conformance Report. Most buyers say "send us your VPAT"
      and mean the ACR.</p>

      <h2>When you need one</h2>
      <p>Almost always in response to a procurement question, most often from:</p>
      <ul>
        <li>US federal agencies and their prime contractors (Section 508)</li>
        <li>State and local government, especially with ADA Title II deadlines approaching</li>
        <li>Universities and school districts</li>
        <li>Large enterprises with accessibility requirements in vendor onboarding</li>
      </ul>
      <p>For many B2B software companies, a missing ACR is a blocked deal. That is why it is worth producing
      before someone asks.</p>

      <h2>The conformance levels</h2>
      <ul>
        <li><strong>Supports</strong> — the functionality meets the criterion without known defects.</li>
        <li><strong>Partially Supports</strong> — some functionality does not meet it.</li>
        <li><strong>Does Not Support</strong> — the majority does not meet it.</li>
        <li><strong>Not Applicable</strong> — the criterion is not relevant to the product.</li>
        <li><strong>Not Evaluated</strong> — permitted only for Level AAA in a standard VPAT, but widely used
        to flag criteria that were not assessed.</li>
      </ul>

      <h2>The honesty problem</h2>
      <p>An ACR is a representation about your product that a buyer may rely on contractually. Marking
      everything "Supports" because an automated scan came back clean is both wrong and risky: only a minority
      of WCAG criteria can be verified by software at all. Criteria like "Meaningful Sequence" or "Error
      Suggestion" require a person.</p>
      <p>Curbcut generates an ACR draft with the automatable criteria prefilled from real scan data and the
      rest explicitly marked as needing manual review. That gets you most of the way at no cost, and shows a
      reviewer exactly where to spend their time.</p>
    `,
  },

  overlays: {
    title: 'Why accessibility overlays do not work',
    description: 'What overlay widgets actually do, why disabled users reject them, and why they do not resolve legal exposure.',
    body: html`
      <h2>What an overlay is</h2>
      <p>An overlay is a JavaScript widget you add to your page. At runtime it attempts to detect and patch
      accessibility problems in the browser — adding ARIA attributes, guessing alt text, and offering a toolbar
      of contrast and font-size controls.</p>

      <h2>Why the approach is structurally limited</h2>
      <ul>
        <li><strong>Your code stays broken.</strong> The widget patches a copy of the page in the visitor's
        browser. Anyone reaching your content another way still hits the original markup.</li>
        <li><strong>Guessed labels can be worse than none.</strong> An image labeled "graphic" or a button
        labeled "button" satisfies a scanner while telling a screen reader user nothing — and it hides the
        problem from your next audit.</li>
        <li><strong>Widgets can conflict with assistive technology.</strong> Screen reader users frequently
        report overlays interfering with software they have already configured to their needs.</li>
        <li><strong>Structural problems are out of reach.</strong> Heading hierarchy, focus order, meaningful
        sequence and keyboard traps are design and code problems. No runtime script resolves them.</li>
      </ul>

      <h2>The community position</h2>
      <p>Thousands of accessibility practitioners and disabled users have signed public statements opposing
      overlays, and many screen reader users block them outright. If the people the product claims to serve
      are actively working around it, it is not solving the problem.</p>

      <h2>The legal reality</h2>
      <p>Installing an overlay has not reliably prevented ADA suits. Businesses using overlay products have
      continued to be sued, and plaintiffs' firms are well aware of which vendors' widgets are on which sites.</p>

      <h2>What to do instead</h2>
      <p>Fix the code. The machine-detectable failures — missing alt attributes, unlabeled inputs, unnamed
      buttons, blocked zoom, broken tab order — are exactly what automated plaintiff tooling looks for, and
      exactly what can be fixed at source once and permanently. Then keep evidence that you are doing it.</p>
    `,
  },
};

export function guidePage(ctx, slug) {
  const guide = GUIDES[slug];
  if (!guide) return null;

  const body = html`
    <div class="wrap-narrow" style="padding-top:2.5rem">
      <p class="small muted"><a href="/">Curbcut</a> → Guides</p>
      <h1>${guide.title}</h1>
      <p class="lede muted">${guide.description}</p>
      <div class="doc-content">${guide.body}</div>

      <div class="card" style="margin-top:2.5rem;background:var(--bg-subtle)">
        <h3>Find out where you actually stand</h3>
        <p class="muted">Scan any public page against WCAG 2.1 AA. No signup, no script to install.</p>
        <form class="scan-form" method="post" action="/scan">
          <label for="guide-scan-url" class="visually-hidden">Website address</label>
          <input type="url" id="guide-scan-url" name="url" required placeholder="https://yourcompany.com">
          <button type="submit" class="btn btn-primary">Run a free scan</button>
        </form>
      </div>
    </div>
  `;

  return page({ title: guide.title, description: guide.description, body, ctx });
}

export const GUIDE_SLUGS = Object.keys(GUIDES);

/* ------------------------------------------------------------------ *
 * Docs, legal, misc
 * ------------------------------------------------------------------ */

export function docsPage(ctx) {
  const body = html`
    <div class="wrap-narrow" style="padding-top:2.5rem">
      <h1>Documentation</h1>

      <h2>Getting started</h2>
      <ol>
        <li>Create an account and add a site with its public base URL.</li>
        <li>Run a scan. Crawling respects <code>robots.txt</code> and stays on the same origin.</li>
        <li>Review findings grouped by issue type, worst first.</li>
        <li>Open the fix plan to get a patch for the mechanical failures.</li>
        <li>Deploy, rescan, and let the ledger record the resolution.</li>
        <li>Generate your evidence documents.</li>
      </ol>

      <h2>Understanding the score</h2>
      <p>The Curbcut score runs from 0 to 100. Each finding contributes a penalty weighted by impact
      (critical 10, serious 5, moderate 2, minor 1) and by confidence — issues needing human review count at
      40% weight. The total is mapped through a saturating curve, so the difference between 0 and 10 issues
      matters far more than between 40 and 400.</p>
      <p>The score is a management metric, not a conformance claim. A score of 100 means no automated
      failures were detected; it does not mean the site conforms to WCAG.</p>

      <h2>Confidence levels</h2>
      <table>
        <thead><tr><th scope="col">Level</th><th scope="col">Meaning</th></tr></thead>
        <tbody>
          <tr><td><strong>Confirmed</strong></td><td>A machine-verifiable failure, such as an image with no alt attribute.</td></tr>
          <tr><td><strong>Needs review</strong></td><td>A strong signal requiring human judgment, such as a skipped heading level.</td></tr>
        </tbody>
      </table>

      <h2>Coverage limits</h2>
      <p>Curbcut analyzes server-rendered HTML. If your page renders its content with JavaScript, we say so
      explicitly on the report rather than reporting a misleadingly clean result. For contrast we resolve
      colors from your stylesheets; where a color comes from a source we cannot evaluate — a CSS variable,
      a gradient, an image — we skip the element rather than invent a number.</p>

      <h2>API</h2>
      <p>See the <a href="/docs/api">API reference</a> for programmatic scanning and CI integration.</p>
    `;

  return page({ title: 'Documentation', description: 'Curbcut documentation: scanning, scoring, coverage limits and API.', body: html`<div class="wrap-narrow" style="padding-top:2.5rem">${body}</div>`, ctx });
}

export function apiDocsPage(ctx) {
  const body = html`
    <div class="wrap-narrow" style="padding-top:2.5rem">
      <h1>API reference</h1>
      <p class="lede muted">Automate scans and fail your build when new violations appear.</p>

      <h2>Authentication</h2>
      <p>Create an API key in Settings. Pass it as a bearer token. Keys are shown once and stored hashed.</p>
      <pre><code>Authorization: Bearer cc_live_xxxxxxxxxxxx</code></pre>

      <h2>Scan a single page</h2>
      <pre><code>POST /api/v1/scan
Content-Type: application/json

{ "url": "https://example.com/checkout" }</code></pre>
      <p>Response:</p>
      <pre><code>{
  "score": 62,
  "url": "https://example.com/checkout",
  "totals": { "total": 24, "critical": 3, "serious": 11, "definite": 18, "review": 6 },
  "coverage": { "complete": true, "mode": "static" },
  "findings": [
    {
      "ruleId": "input-label",
      "impact": "critical",
      "confidence": "definite",
      "wcag": ["1.3.1", "3.3.2", "4.1.2"],
      "message": "Form field has no associated label.",
      "selector": "form > input:nth-of-type(2)",
      "line": 84
    }
  ]
}</code></pre>

      <h2>List sites</h2>
      <pre><code>GET /api/v1/sites</code></pre>

      <h2>Trigger a site scan</h2>
      <pre><code>POST /api/v1/sites/{siteId}/scans</code></pre>

      <h2>Fail CI on regressions</h2>
      <p>Exit non-zero when a page introduces confirmed failures:</p>
      <pre><code>#!/usr/bin/env bash
set -euo pipefail

RESULT=$(curl -sS -X POST https://curbcut.dev/api/v1/scan \\
  -H "Authorization: Bearer $CURBCUT_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d "{\\"url\\": \\"$DEPLOY_URL\\"}")

COUNT=$(echo "$RESULT" | grep -o '"definite":[0-9]*' | cut -d: -f2)

if [ "${'$'}{COUNT:-0}" -gt 0 ]; then
  echo "Accessibility check failed: $COUNT confirmed violations"
  exit 1
fi</code></pre>

      <h2>Rate limits</h2>
      <p>60 requests per minute per key. Scans count against your plan's monthly allowance.</p>

      <h2>Errors</h2>
      <table>
        <thead><tr><th scope="col">Status</th><th scope="col">Meaning</th></tr></thead>
        <tbody>
          <tr><td>400</td><td>Invalid or unreachable URL</td></tr>
          <tr><td>401</td><td>Missing or revoked API key</td></tr>
          <tr><td>402</td><td>Plan does not include API access</td></tr>
          <tr><td>429</td><td>Rate limit or monthly scan quota exceeded</td></tr>
        </tbody>
      </table>
    </div>
  `;
  return page({ title: 'API reference', description: 'Curbcut REST API for automated accessibility scanning and CI integration.', body, ctx });
}

export function legalPage(ctx, kind) {
  const isPrivacy = kind === 'privacy';
  const body = html`
    <div class="wrap-narrow" style="padding-top:2.5rem">
      <h1>${isPrivacy ? 'Privacy policy' : 'Terms of service'}</h1>
      <p class="muted">Last updated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</p>
      ${isPrivacy
        ? html`
          <h2>What we collect</h2>
          <p>Account details (name, email), the URLs you ask us to scan, the HTML and CSS of those pages, the
          findings we derive, and product usage events used to improve the service.</p>
          <h2>What we do not do</h2>
          <p>We do not sell personal data. We do not place tracking scripts on your website — Curbcut adds
          nothing to your site.</p>
          <h2>Retention</h2>
          <p>Scan data is retained while your account is active so we can maintain your remediation history.
          You may delete a site and its scan data at any time from Settings.</p>
          <h2>Subprocessors</h2>
          <p>Hosting and payment processing (Stripe). A current list is available on request.</p>
          <h2>Your rights</h2>
          <p>You may request access to, correction of, or deletion of your personal data by contacting us.</p>`
        : html`
          <h2>The service</h2>
          <p>Curbcut provides automated accessibility testing, remediation suggestions and documentation
          generation.</p>
          <h2>No legal advice, no guarantee of compliance</h2>
          <p><strong>Curbcut does not provide legal advice and does not guarantee compliance with the ADA,
          Section 508, the European Accessibility Act or any other law.</strong> Automated testing detects a
          subset of accessibility barriers. Documents generated by the service are drafts requiring your
          review, and criteria marked "Not Evaluated" or "Needs Manual Review" have not been assessed.</p>
          <h2>Acceptable use</h2>
          <p>Scan only properties you own or are authorised to test. We respect <code>robots.txt</code> and
          rate-limit our crawler; you agree not to use the service to burden third-party infrastructure.</p>
          <h2>Billing</h2>
          <p>Subscriptions renew automatically until canceled. Cancel anytime; access continues to the end of
          the paid period, after which the account reverts to the free plan with history intact.</p>
          <h2>Liability</h2>
          <p>The service is provided "as is". To the maximum extent permitted by law, our aggregate liability
          is limited to the amount you paid in the preceding twelve months.</p>`}
    </div>
  `;
  return page({ title: isPrivacy ? 'Privacy policy' : 'Terms of service', body, ctx });
}

export function contactPage(ctx, { sent = false } = {}) {
  const body = html`
    <div class="wrap-narrow" style="padding-top:2.5rem">
      <h1>Talk to us</h1>
      ${sent ? alert('success', "Thanks — we'll be in touch within one business day.") : ''}
      <p class="muted">Human-verified audits, agency partnerships, procurement questions, or anything else.</p>
      <form method="post" action="/contact" class="card">
        <input type="hidden" name="_csrf" value="${ctx.csrf}">
        <div class="field">
          <label for="contact-email">Email</label>
          <input type="email" id="contact-email" name="email" required autocomplete="email">
        </div>
        <div class="field">
          <label for="contact-company">Company</label>
          <input type="text" id="contact-company" name="company" autocomplete="organization">
        </div>
        <div class="field">
          <label for="contact-message">How can we help?</label>
          <textarea id="contact-message" name="message" rows="5" required></textarea>
        </div>
        <button type="submit" class="btn btn-primary">Send</button>
      </form>
    </div>
  `;
  return page({ title: 'Contact', body, ctx });
}

/** Our own accessibility statement. Dogfooding, and a trust signal. */
export function ourAccessibilityPage(ctx) {
  const body = html`
    <div class="wrap-narrow doc-content" style="padding-top:2.5rem">
      <h1>Accessibility statement for Curbcut</h1>
      <p>We sell accessibility remediation, so it would be indefensible for this site not to meet the
      standard we hold our customers to.</p>

      <h2>Conformance status</h2>
      <p>Curbcut aims to conform to WCAG 2.1 Level AA. This application is server-rendered semantic HTML.
      It works without JavaScript, respects <code>prefers-reduced-motion</code> and
      <code>prefers-color-scheme</code>, uses visible focus indicators throughout, and supports zoom to
      200% without loss of content.</p>

      <h2>How we test</h2>
      <p>Every page of this application is scanned by Curbcut itself on each release, and our test suite
      fails the build if the marketing pages or the application shell produce any confirmed failure.</p>

      <h2>Known limitations</h2>
      <p>Scan report pages can contain long code snippets from customer sites, which may extend horizontally
      on narrow screens. They are contained in scrollable regions with keyboard access.</p>

      <h2>Feedback</h2>
      <p>If you encounter a barrier here, please <a href="/contact">tell us</a>. We treat accessibility bugs
      in our own product as our highest priority defect class.</p>
    </div>
  `;
  return page({ title: 'Accessibility statement', body, ctx });
}

export function notFoundPage(ctx) {
  const body = html`
    <div class="wrap-narrow center" style="padding:5rem 1.25rem">
      <h1>Page not found</h1>
      <p class="muted">That page doesn't exist. It may have moved.</p>
      <p><a class="btn btn-primary" href="/">Back to home</a></p>
    </div>
  `;
  return page({ title: 'Page not found', body, ctx });
}

export function errorPage(ctx, requestId) {
  const body = html`
    <div class="wrap-narrow center" style="padding:5rem 1.25rem">
      <h1>Something went wrong</h1>
      <p class="muted">We've logged the problem. Please try again.</p>
      ${requestId ? html`<p class="small muted">Reference: <code>${requestId}</code></p>` : ''}
      <p><a class="btn btn-primary" href="/">Back to home</a></p>
    </div>
  `;
  return page({ title: 'Error', body, ctx });
}
