import { html, raw } from '../html.js';
import { page, alert } from '../layout.js';
import { SERVICE_TIERS } from '../../services.js';
import { coverageStats } from '../../evidence/wcag.js';

const coverage = coverageStats();

export function servicesPage(ctx, { sent = false, kind = null, error = null, values = {} } = {}) {
  const selected = kind && SERVICE_TIERS[kind] ? SERVICE_TIERS[kind] : null;

  const body = html`
    <div class="wrap">
      <section class="hero" style="padding-bottom:1.5rem">
        <p class="eyebrow">Done with you, or done for you</p>
        <h1>Have us do the work</h1>
        <p class="lede">
          The software finds and fixes what a machine can. These are for everything else — the
          ${String(coverage.none)} WCAG criteria no tool can judge, and the work you would rather not
          hand to your own developers.
        </p>
      </section>

      ${sent
        ? alert('success', "Thanks — we've got your request. We'll reply within one business day with next steps and a scope.")
        : ''}
      ${error ? alert('error', error) : ''}

      <section style="margin-top:0">
        <div class="grid grid-3">
          ${Object.values(SERVICE_TIERS).map((tier) => html`
            <div class="card price-card${selected && selected.id === tier.id ? ' popular' : ''}">
              <h2 style="font-size:1.1rem">${tier.name}</h2>
              <p class="price-tag" style="font-size:1.6rem">${tier.price}</p>
              <p class="small muted">${tier.priceNote}</p>
              <p class="small">${tier.summary}</p>
              <ul>${tier.includes.map((item) => html`<li>${item}</li>`)}</ul>
              <p class="small muted"><strong>Best for:</strong> ${tier.bestFor}</p>
              <p class="small muted tight"><strong>Turnaround:</strong> ${tier.turnaround}</p>
              <a class="btn ${selected && selected.id === tier.id ? 'btn-primary' : 'btn-secondary'}"
                 href="/services?kind=${tier.id}#request" style="margin-top:1rem"
                 aria-label="Request the ${tier.name}">Request this</a>
            </div>`)}
        </div>
      </section>

      <section>
        <div class="card" style="background:var(--bg-subtle)">
          <h2>Why services exist at all</h2>
          <p style="max-width:66ch">
            Of the ${String(coverage.total)} WCAG 2.1 A and AA success criteria, ${String(coverage.full)}
            can be fully verified by software and ${String(coverage.partial)} partially. The remaining
            ${String(coverage.none)} require a person — often a person using a screen reader. Any vendor
            selling you a fully automated path to a signed conformance report is misrepresenting what
            software can do.
          </p>
          <p style="max-width:66ch" class="tight">
            Our reviewers start from your Curbcut data, so they spend their time on the criteria that
            actually need judgment instead of re-finding what the scanner already found. That is why
            this costs a fraction of an audit that starts from a blank page.
          </p>
        </div>
      </section>

      <section id="request">
        <div class="card" style="max-width:640px">
          <h2 style="font-size:1.2rem">Request a scope and quote</h2>
          <p class="muted small">No obligation. We'll tell you honestly if you don't need us.</p>

          <form method="post" action="/services">
            ${ctx.csrf ? html`<input type="hidden" name="_csrf" value="${ctx.csrf}">` : ''}

            <div class="field">
              <label for="svc-kind">What do you need?</label>
              <select id="svc-kind" name="kind" required>
                ${Object.values(SERVICE_TIERS).map((tier) => html`
                  <option value="${tier.id}"${selected && selected.id === tier.id ? raw(' selected') : raw('')}>
                    ${tier.name} — ${tier.price}
                  </option>`)}
              </select>
            </div>

            <div class="field">
              <label for="svc-email">Work email</label>
              <input type="email" id="svc-email" name="contactEmail" required autocomplete="email"
                     value="${values.contactEmail || ctx.org?.contact_email || ''}">
            </div>

            <div class="field">
              <label for="svc-name">Your name</label>
              <input type="text" id="svc-name" name="contactName" autocomplete="name" value="${values.contactName || ''}">
            </div>

            <div class="field">
              <label for="svc-company">Company</label>
              <input type="text" id="svc-company" name="company" autocomplete="organization" value="${values.company || ''}">
            </div>

            <div class="field">
              <label for="svc-url">Website</label>
              <input type="url" id="svc-url" name="siteUrl" placeholder="https://yourcompany.com"
                     autocomplete="url" value="${values.siteUrl || ''}">
            </div>

            <div class="field">
              <label for="svc-notes">What's driving this?</label>
              <textarea id="svc-notes" name="notes" rows="4"
                        placeholder="A demand letter, a procurement request, an upcoming deadline, or just getting ahead of it.">${values.notes || ''}</textarea>
              <p class="hint">Deadlines and legal context help us scope accurately.</p>
            </div>

            <button type="submit" class="btn btn-primary btn-lg">Request a quote</button>
          </form>
        </div>
      </section>
    </div>
  `;

  return page({
    title: 'Services',
    description: 'Human-verified accessibility audits, done-for-you remediation, and ongoing compliance support from the Curbcut team.',
    body,
    ctx,
  });
}

/** Compact prompt shown on a scan report when the backlog looks heavy. */
export function serviceCallout(ctx, { siteId, scanId, definiteCount }) {
  if (!definiteCount || definiteCount < 5) return '';
  return html`
    <div class="card" style="background:var(--bg-subtle);border-left:3px solid var(--accent);margin-bottom:1.5rem">
      <div class="row-between">
        <div style="max-width:60ch">
          <h2 style="font-size:1.05rem;margin-bottom:.3rem">Want us to handle this?</h2>
          <p class="small muted tight">
            ${String(definiteCount)} confirmed failures is a real chunk of engineering time. We can fix
            them for you and deliver the changes as pull requests, with a dated record of the work.
          </p>
        </div>
        <a class="btn btn-primary" href="/services?kind=remediation&amp;site=${siteId}&amp;scan=${scanId}#request">
          Get a quote
        </a>
      </div>
    </div>`;
}
