import { html } from '../html.js';
import { page, alert } from '../layout.js';
import { PLANS } from '../../plans.js';

export function signupPage(ctx, { error = null, values = {}, plan = null, url = null } = {}) {
  const chosenPlan = plan && PLANS[plan] ? PLANS[plan] : null;

  const body = html`
    <div class="wrap-narrow" style="padding:3rem 1.25rem;max-width:520px">
      <h1>Create your account</h1>
      <p class="muted">
        ${chosenPlan
          ? `Starting with the ${chosenPlan.name} plan.`
          : 'Every account starts with a 14-day trial of Growth. No card required.'}
      </p>

      ${error ? alert('error', error) : ''}

      <form method="post" action="/signup" class="card">
        <input type="hidden" name="_csrf" value="${ctx.csrf}">
        ${plan ? html`<input type="hidden" name="plan" value="${plan}">` : ''}
        ${url ? html`<input type="hidden" name="url" value="${url}">` : ''}

        <div class="field">
          <label for="signup-name">Your name</label>
          <input type="text" id="signup-name" name="name" autocomplete="name" value="${values.name || ''}">
        </div>

        <div class="field">
          <label for="signup-email">Work email</label>
          <input type="email" id="signup-email" name="email" required autocomplete="email"
                 value="${values.email || ''}" ${error ? html`aria-invalid="true"` : ''}>
        </div>

        <div class="field">
          <label for="signup-org">Company or team name</label>
          <input type="text" id="signup-org" name="orgName" autocomplete="organization" value="${values.orgName || ''}">
          <p class="hint">You can change this later.</p>
        </div>

        <div class="field">
          <label for="signup-password">Password</label>
          <input type="password" id="signup-password" name="password" required
                 autocomplete="new-password" minlength="10" aria-describedby="password-hint">
          <p class="hint" id="password-hint">At least 10 characters. Length matters more than symbols.</p>
        </div>

        <button type="submit" class="btn btn-primary btn-lg" style="width:100%">Create account</button>
      </form>

      <p class="center muted small">
        Already have an account? <a href="/login">Sign in</a>
      </p>
      <p class="center muted small">
        By creating an account you agree to our <a href="/legal/terms">terms</a> and
        <a href="/legal/privacy">privacy policy</a>.
      </p>
    </div>
  `;

  return page({ title: 'Create your account', body, ctx });
}

export function loginPage(ctx, { error = null, email = '', next = null } = {}) {
  const body = html`
    <div class="wrap-narrow" style="padding:3rem 1.25rem;max-width:460px">
      <h1>Sign in</h1>
      ${error ? alert('error', error) : ''}

      <form method="post" action="/login" class="card">
        <input type="hidden" name="_csrf" value="${ctx.csrf}">
        ${next ? html`<input type="hidden" name="next" value="${next}">` : ''}

        <div class="field">
          <label for="login-email">Email</label>
          <input type="email" id="login-email" name="email" required autocomplete="email" value="${email}">
        </div>

        <div class="field">
          <label for="login-password">Password</label>
          <input type="password" id="login-password" name="password" required autocomplete="current-password">
          <p class="hint"><a href="/forgot-password">Forgot your password?</a></p>
        </div>

        <button type="submit" class="btn btn-primary btn-lg" style="width:100%">Sign in</button>
      </form>

      <p class="center muted small">
        New here? <a href="/signup">Create an account</a>
      </p>
    </div>
  `;

  return page({ title: 'Sign in', body, ctx });
}
