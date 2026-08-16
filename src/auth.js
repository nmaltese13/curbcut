import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHmac, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { get, run, all } from './db.js';
import config from './config.js';
import log from './log.js';

const scryptAsync = promisify(scrypt);

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };
const SESSION_DAYS = 30;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, SCRYPT_PARAMS.keylen, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const derived = await scryptAsync(password, salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

export function validatePassword(password) {
  if (!password || password.length < 10) {
    return 'Use at least 10 characters. Length matters more than symbols.';
  }
  if (password.length > 200) return 'That password is too long.';
  const common = ['password12', 'password123', '1234567890', 'qwertyuiop', 'letmein123'];
  if (common.includes(password.toLowerCase())) return 'That password is too easy to guess.';
  return null;
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

/* ------------------------------------------------------------------ *
 * Sessions
 * ------------------------------------------------------------------ */

export function createSession(userId, orgId, { ip, userAgent } = {}) {
  const id = randomBytes(32).toString('base64url');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  run(
    `INSERT INTO sessions (id, user_id, org_id, created_at, expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    id, userId, orgId, now.toISOString(), expires.toISOString(), ip || null, (userAgent || '').slice(0, 300)
  );
  return { id, expires };
}

export function getSession(sessionId) {
  if (!sessionId) return null;
  const session = get('SELECT * FROM sessions WHERE id = ?', sessionId);
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) {
    run('DELETE FROM sessions WHERE id = ?', sessionId);
    return null;
  }
  const user = get('SELECT id, email, name, is_admin, created_at FROM users WHERE id = ?', session.user_id);
  if (!user) return null;

  const memberships = all(
    `SELECT m.org_id, m.role, o.name, o.slug, o.plan, o.billing_status, o.trial_ends_at
     FROM memberships m JOIN orgs o ON o.id = m.org_id
     WHERE m.user_id = ? ORDER BY m.created_at`,
    user.id
  );

  const activeOrgId = session.org_id && memberships.some((m) => m.org_id === session.org_id)
    ? session.org_id
    : memberships[0]?.org_id || null;

  const org = activeOrgId ? get('SELECT * FROM orgs WHERE id = ?', activeOrgId) : null;
  const membership = memberships.find((m) => m.org_id === activeOrgId) || null;

  return { session, user, org, membership, memberships };
}

export function destroySession(sessionId) {
  if (sessionId) run('DELETE FROM sessions WHERE id = ?', sessionId);
}

export function switchOrg(sessionId, orgId) {
  run('UPDATE sessions SET org_id = ? WHERE id = ?', orgId, sessionId);
}

export function purgeExpiredSessions() {
  const result = run('DELETE FROM sessions WHERE expires_at < ?', new Date().toISOString());
  if (result.changes) log.debug('purged expired sessions', { count: result.changes });
}

/* ------------------------------------------------------------------ *
 * CSRF
 * ------------------------------------------------------------------ */

/**
 * Tokens are derived from the session id, so they need no server-side storage
 * and are automatically invalidated when the session ends.
 */
export function csrfToken(sessionId) {
  if (!sessionId) return '';
  return createHmac('sha256', config.sessionSecret).update(`csrf:${sessionId}`).digest('base64url');
}

export function verifyCsrf(sessionId, token) {
  if (!sessionId || !token) return false;
  const expected = csrfToken(sessionId);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(token));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ *
 * Accounts
 * ------------------------------------------------------------------ */

function slugify(text) {
  const base = String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return base || 'team';
}

function uniqueSlug(base) {
  let candidate = base;
  let suffix = 1;
  while (get('SELECT 1 FROM orgs WHERE slug = ?', candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  return candidate;
}

export async function registerUser({ email, password, name, orgName }) {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) throw new AuthError('Enter a valid email address.');

  const passwordError = validatePassword(password);
  if (passwordError) throw new AuthError(passwordError);

  if (get('SELECT 1 FROM users WHERE email = ?', normalizedEmail)) {
    throw new AuthError('An account with that email already exists. Try signing in instead.');
  }

  const now = new Date().toISOString();
  const userId = randomUUID();
  const orgId = randomUUID();
  const passwordHash = await hashPassword(password);
  const teamName = (orgName || '').trim() || `${normalizedEmail.split('@')[0]}'s team`;

  // A 14-day trial of Growth removes the pricing decision from the signup flow.
  const trialEnds = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

  run(
    `INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)`,
    userId, normalizedEmail, passwordHash, (name || '').trim() || null, now
  );
  run(
    `INSERT INTO orgs (id, name, slug, plan, contact_email, trial_ends_at, created_at)
     VALUES (?, ?, ?, 'growth', ?, ?, ?)`,
    orgId, teamName, uniqueSlug(slugify(teamName)), normalizedEmail, trialEnds, now
  );
  run(
    `INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`,
    orgId, userId, now
  );

  return { userId, orgId };
}

export async function authenticate(email, password) {
  const normalizedEmail = normalizeEmail(email);
  const user = get('SELECT * FROM users WHERE email = ?', normalizedEmail);

  // Always run a hash comparison so the response time does not reveal whether
  // the account exists.
  const stored = user ? user.password_hash : await hashPassword(randomBytes(16).toString('hex'));
  const ok = await verifyPassword(password, stored);

  if (!user || !ok) return null;

  run('UPDATE users SET last_login_at = ? WHERE id = ?', new Date().toISOString(), user.id);
  return user;
}

/* ------------------------------------------------------------------ *
 * Password reset
 * ------------------------------------------------------------------ */

const RESET_TTL_MINUTES = 60;
export const RESET_EXPIRY_MINUTES = RESET_TTL_MINUTES;

/**
 * Issue a reset token.
 *
 * Returns null when no account matches, and the caller must respond identically
 * either way — telling a stranger which email addresses have accounts is an
 * account-enumeration leak.
 *
 * The token is returned once and stored only as a hash, so a database copy does
 * not grant the ability to seize accounts.
 */
export function createPasswordReset(email, { ip = null } = {}) {
  const user = get('SELECT id FROM users WHERE email = ?', normalizeEmail(email));
  if (!user) return null;

  // One live token per user: issuing a new link invalidates the previous one.
  run('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL', user.id);

  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000);
  run(
    `INSERT INTO password_resets (token_hash, user_id, expires_at, requested_ip, created_at)
     VALUES (?, ?, ?, ?, ?)`,
    hashToken(token), user.id, expires.toISOString(), ip, new Date().toISOString()
  );
  return { token, userId: user.id, expiresAt: expires };
}

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

/** Look up a reset token without consuming it, for rendering the form. */
export function findPasswordReset(token) {
  if (!token) return null;
  const record = get('SELECT * FROM password_resets WHERE token_hash = ?', hashToken(token));
  if (!record) return null;
  if (record.used_at) return null;
  if (new Date(record.expires_at) < new Date()) return null;
  return record;
}

/**
 * Consume a token and set the new password. Every session for that user is
 * destroyed: if the reset was triggered because the account was compromised,
 * leaving the attacker's session alive would defeat the point.
 */
export async function completePasswordReset(token, newPassword) {
  const record = findPasswordReset(token);
  if (!record) throw new AuthError('That reset link is invalid or has expired. Request a new one.');

  const problem = validatePassword(newPassword);
  if (problem) throw new AuthError(problem);

  const passwordHash = await hashPassword(newPassword);
  run('UPDATE users SET password_hash = ? WHERE id = ?', passwordHash, record.user_id);
  run('UPDATE password_resets SET used_at = ? WHERE token_hash = ?', new Date().toISOString(), record.token_hash);
  run('DELETE FROM sessions WHERE user_id = ?', record.user_id);

  return record.user_id;
}

/* ------------------------------------------------------------------ *
 * Team invitations
 * ------------------------------------------------------------------ */

const INVITE_TTL_DAYS = 14;
export const INVITE_EXPIRY_DAYS = INVITE_TTL_DAYS;

export function createInvitation({ orgId, email, role = 'member', invitedBy = null }) {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) throw new AuthError('Enter a valid email address.');

  const existing = get(
    `SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.org_id = ? AND u.email = ?`,
    orgId, normalized
  );
  if (existing) throw new AuthError('That person is already on your team.');

  run(
    `UPDATE invitations SET revoked_at = ?
     WHERE org_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    new Date().toISOString(), orgId, normalized
  );

  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  run(
    `INSERT INTO invitations (token_hash, org_id, email, role, invited_by, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    hashToken(token), orgId, normalized, role === 'admin' ? 'admin' : 'member',
    invitedBy, expires.toISOString(), new Date().toISOString()
  );

  return { token, email: normalized, expiresAt: expires };
}

export function findInvitation(token) {
  if (!token) return null;
  const record = get(
    `SELECT i.*, o.name AS org_name FROM invitations i
     JOIN orgs o ON o.id = i.org_id WHERE i.token_hash = ?`,
    hashToken(token)
  );
  if (!record) return null;
  if (record.accepted_at || record.revoked_at) return null;
  if (new Date(record.expires_at) < new Date()) return null;
  return record;
}

export function listInvitations(orgId) {
  return all(
    `SELECT i.email, i.role, i.created_at, i.expires_at, i.accepted_at, i.revoked_at,
            u.email AS invited_by_email
     FROM invitations i LEFT JOIN users u ON u.id = i.invited_by
     WHERE i.org_id = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL
     ORDER BY i.created_at DESC`,
    orgId
  );
}

export function revokeInvitation(orgId, email) {
  run(
    `UPDATE invitations SET revoked_at = ?
     WHERE org_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL`,
    new Date().toISOString(), orgId, normalizeEmail(email)
  );
}

/**
 * Accept an invitation, creating the user account when they are new.
 * Returns { userId, orgId }.
 */
export async function acceptInvitation(token, { name, password } = {}) {
  const invite = findInvitation(token);
  if (!invite) throw new AuthError('That invitation is invalid, revoked, or has expired.');

  let user = get('SELECT * FROM users WHERE email = ?', invite.email);
  const now = new Date().toISOString();

  if (!user) {
    const problem = validatePassword(password);
    if (problem) throw new AuthError(problem);
    const userId = randomUUID();
    run(
      `INSERT INTO users (id, email, password_hash, name, created_at) VALUES (?, ?, ?, ?, ?)`,
      userId, invite.email, await hashPassword(password), (name || '').trim() || null, now
    );
    user = { id: userId };
  }

  const already = get('SELECT 1 FROM memberships WHERE org_id = ? AND user_id = ?', invite.org_id, user.id);
  if (!already) {
    run(
      `INSERT INTO memberships (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)`,
      invite.org_id, user.id, invite.role, now
    );
  }

  run('UPDATE invitations SET accepted_at = ? WHERE token_hash = ?', now, invite.token_hash);
  return { userId: user.id, orgId: invite.org_id, isNewUser: !already };
}

export function purgeExpiredTokens() {
  const now = new Date().toISOString();
  run('DELETE FROM password_resets WHERE expires_at < ?', now);
  run('DELETE FROM invitations WHERE expires_at < ? AND accepted_at IS NULL', now);
}

export class AuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthError';
    this.userFacing = true;
  }
}

/* ------------------------------------------------------------------ *
 * API keys
 * ------------------------------------------------------------------ */

export function createApiKey(orgId, name, userId) {
  const secret = randomBytes(24).toString('base64url');
  const key = `cc_live_${secret}`;
  const prefix = key.slice(0, 12);
  run(
    `INSERT INTO api_keys (id, org_id, name, prefix, key_hash, created_at, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(), orgId, name || 'API key', prefix, hashApiKey(key), new Date().toISOString(), userId || null
  );
  // Returned once and never stored in plaintext.
  return key;
}

export function hashApiKey(key) {
  return createHash('sha256').update(key).digest('hex');
}

export function resolveApiKey(key) {
  if (!key || !key.startsWith('cc_live_')) return null;
  const record = get('SELECT * FROM api_keys WHERE key_hash = ? AND revoked_at IS NULL', hashApiKey(key));
  if (!record) return null;
  run('UPDATE api_keys SET last_used_at = ? WHERE id = ?', new Date().toISOString(), record.id);
  const org = get('SELECT * FROM orgs WHERE id = ?', record.org_id);
  return org ? { org, apiKey: record } : null;
}

export default { registerUser, authenticate, createSession, getSession };
