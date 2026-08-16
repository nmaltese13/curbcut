import { html } from '../html.js';
import { page, alert } from '../layout.js';

/* ------------------------------------------------------------------ *
 * Password reset
 * ------------------------------------------------------------------ */

export function forgotPasswordPage(ctx, { sent = false, email = '', error = null } = {}) {
  const body = html`
    <div class="wrap-narrow" style="padding:3rem 1.25rem;max-width:460px">
      <h1>Reset your password</h1>

      ${sent
        ? html`
          ${alert('success', 'If an account exists for that address, a reset link is on its way.')}
          <p class="muted">
            The link expires in an hour and can only be used once. Check your spam folder if it
            does not arrive within a few minutes.
          </p>
          <p><a class="btn btn-secondary" href="/login">Back to sign in</a></p>`
        : html`
          <p class="muted">Enter the email address on your account and we'll send you a link.</p>
          ${error ? alert('error', error) : ''}
          <form method="post" action="/forgot-password" class="card">
            <div class="field">
              <label for="forgot-email">Email address</label>
              <input type="email" id="forgot-email" name="email" required autocomplete="email" value="${email}">
            </div>
            <button type="submit" class="btn btn-primary btn-lg" style="width:100%">Send reset link</button>
          </form>
          <p class="center muted small"><a href="/login">Back to sign in</a></p>`}
    </div>
  `;
  return page({ title: 'Reset your password', body, ctx });
}

export function resetPasswordPage(ctx, { token, error = null, invalid = false } = {}) {
  const body = html`
    <div class="wrap-narrow" style="padding:3rem 1.25rem;max-width:460px">
      <h1>Choose a new password</h1>

      ${invalid
        ? html`
          ${alert('error', 'That reset link is invalid or has expired.')}
          <p class="muted">Reset links last one hour and can only be used once.</p>
          <p><a class="btn btn-primary" href="/forgot-password">Request a new link</a></p>`
        : html`
          ${error ? alert('error', error) : ''}
          <form method="post" action="/reset-password" class="card">
            <input type="hidden" name="token" value="${token}">
            <div class="field">
              <label for="new-password">New password</label>
              <input type="password" id="new-password" name="password" required
                     autocomplete="new-password" minlength="10" aria-describedby="new-password-hint">
              <p class="hint" id="new-password-hint">At least 10 characters. Length matters more than symbols.</p>
            </div>
            <button type="submit" class="btn btn-primary btn-lg" style="width:100%">Set new password</button>
          </form>
          <p class="center muted small">
            Setting a new password signs out every other device.
          </p>`}
    </div>
  `;
  return page({ title: 'Choose a new password', body, ctx });
}

/* ------------------------------------------------------------------ *
 * Invitations
 * ------------------------------------------------------------------ */

export function acceptInvitePage(ctx, { invite, token, error = null, invalid = false, values = {} } = {}) {
  const body = html`
    <div class="wrap-narrow" style="padding:3rem 1.25rem;max-width:480px">
      ${invalid
        ? html`
          <h1>This invitation is no longer valid</h1>
          ${alert('error', 'It may have expired, been revoked, or already been used.')}
          <p class="muted">Ask whoever invited you to send a new one.</p>
          <p><a class="btn btn-secondary" href="/">Back to Curbcut</a></p>`
        : html`
          <h1>Join ${invite.org_name}</h1>
          <p class="muted">
            You were invited as <strong>${invite.email}</strong>. Set a password to accept.
          </p>
          ${error ? alert('error', error) : ''}

          <form method="post" action="/invite/accept" class="card">
            <input type="hidden" name="token" value="${token}">
            <div class="field">
              <label for="invite-name">Your name</label>
              <input type="text" id="invite-name" name="name" autocomplete="name" value="${values.name || ''}">
            </div>
            <div class="field">
              <label for="invite-password">Choose a password</label>
              <input type="password" id="invite-password" name="password" required
                     autocomplete="new-password" minlength="10" aria-describedby="invite-password-hint">
              <p class="hint" id="invite-password-hint">
                At least 10 characters. If you already have a Curbcut account with this address,
                enter its existing password.
              </p>
            </div>
            <button type="submit" class="btn btn-primary btn-lg" style="width:100%">Accept invitation</button>
          </form>`}
    </div>
  `;
  return page({ title: invalid ? 'Invitation expired' : `Join ${invite?.org_name || 'a team'}`, body, ctx });
}
