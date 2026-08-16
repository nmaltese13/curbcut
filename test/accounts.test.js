import './helpers/test-env.js';

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';

import { run, get, all } from '../src/db.js';
import {
  registerUser, authenticate, createSession, getSession,
  createPasswordReset, findPasswordReset, completePasswordReset,
  createInvitation, findInvitation, acceptInvitation, listInvitations, revokeInvitation,
} from '../src/auth.js';
import { sendEmail, recentEmails, getEmail } from '../src/email.js';
import { tick, setSchedule, dueSites, frequencyAllowed, FREQUENCIES } from '../src/scheduler.js';

/**
 * The account lifecycle a real customer depends on: recovering a lost password,
 * adding a teammate, and having scans run without anyone asking.
 */

let userId;
let orgId;

before(async () => {
  const result = await registerUser({
    email: 'owner@example.com',
    password: 'original-password-1',
    name: 'Owner',
    orgName: 'Acme',
  });
  userId = result.userId;
  orgId = result.orgId;
});

describe('password reset', () => {
  test('issues a single-use token that is never stored in the clear', () => {
    const reset = createPasswordReset('owner@example.com');
    assert.ok(reset.token && reset.token.length > 20);

    const stored = all('SELECT * FROM password_resets WHERE user_id = ?', userId);
    assert.equal(stored.length, 1);
    assert.ok(!stored[0].token_hash.includes(reset.token), 'the raw token must not be stored');
    assert.notEqual(stored[0].token_hash, reset.token);
  });

  test('returns nothing for an unknown address, without revealing that', () => {
    // The route responds identically either way; this asserts the underlying
    // primitive gives the caller no account-existence signal beyond null.
    assert.equal(createPasswordReset('nobody@example.com'), null);
  });

  test('issuing a new token invalidates the previous one', () => {
    const first = createPasswordReset('owner@example.com');
    const second = createPasswordReset('owner@example.com');
    assert.equal(findPasswordReset(first.token), null, 'the old link must stop working');
    assert.ok(findPasswordReset(second.token));
  });

  test('changes the password and signs out every existing session', async () => {
    const session = createSession(userId, orgId, {});
    assert.ok(getSession(session.id), 'session should exist before the reset');

    const reset = createPasswordReset('owner@example.com');
    await completePasswordReset(reset.token, 'a-brand-new-password');

    assert.ok(await authenticate('owner@example.com', 'a-brand-new-password'));
    assert.equal(await authenticate('owner@example.com', 'original-password-1'), null);
    // A reset is how someone recovers a compromised account; leaving the
    // attacker's session alive would defeat the purpose.
    assert.equal(getSession(session.id), null, 'existing sessions must be destroyed');
  });

  test('a token cannot be reused', async () => {
    const reset = createPasswordReset('owner@example.com');
    await completePasswordReset(reset.token, 'yet-another-password');
    await assert.rejects(
      () => completePasswordReset(reset.token, 'third-password-here'),
      /invalid or has expired/i
    );
  });

  test('rejects a weak new password', async () => {
    const reset = createPasswordReset('owner@example.com');
    await assert.rejects(() => completePasswordReset(reset.token, 'short'), /10 characters/i);
  });

  test('rejects an expired token', async () => {
    const reset = createPasswordReset('owner@example.com');
    run(
      'UPDATE password_resets SET expires_at = ? WHERE user_id = ? AND used_at IS NULL',
      new Date(Date.now() - 1000).toISOString(), userId
    );
    assert.equal(findPasswordReset(reset.token), null);
  });
});

describe('team invitations', () => {
  test('creates an invitation and lists it as pending', () => {
    const invite = createInvitation({ orgId, email: 'Teammate@Example.com ', invitedBy: userId });
    assert.equal(invite.email, 'teammate@example.com', 'email should be normalized');

    const pending = listInvitations(orgId);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].email, 'teammate@example.com');
  });

  test('a new person accepts and joins the org', async () => {
    const invite = createInvitation({ orgId, email: 'newbie@example.com', invitedBy: userId });
    const result = await acceptInvitation(invite.token, { name: 'Newbie', password: 'newbie-password-1' });

    assert.equal(result.orgId, orgId);
    const membership = get('SELECT * FROM memberships WHERE org_id = ? AND user_id = ?', orgId, result.userId);
    assert.ok(membership, 'membership should be created');
    assert.equal(membership.role, 'member');
    assert.ok(await authenticate('newbie@example.com', 'newbie-password-1'));
  });

  test('an accepted invitation cannot be reused', async () => {
    const invite = createInvitation({ orgId, email: 'once@example.com', invitedBy: userId });
    await acceptInvitation(invite.token, { name: 'Once', password: 'once-password-123' });
    await assert.rejects(
      () => acceptInvitation(invite.token, { name: 'Twice', password: 'twice-password-12' }),
      /invalid, revoked, or has expired/i
    );
  });

  test('a revoked invitation stops working', () => {
    const invite = createInvitation({ orgId, email: 'revoked@example.com', invitedBy: userId });
    revokeInvitation(orgId, 'revoked@example.com');
    assert.equal(findInvitation(invite.token), null);
  });

  test('refuses to invite someone already on the team', () => {
    assert.throws(
      () => createInvitation({ orgId, email: 'owner@example.com', invitedBy: userId }),
      /already on your team/i
    );
  });

  test('honors the admin role when granted', async () => {
    const invite = createInvitation({ orgId, email: 'boss@example.com', role: 'admin', invitedBy: userId });
    const result = await acceptInvitation(invite.token, { name: 'Boss', password: 'boss-password-123' });
    const membership = get('SELECT role FROM memberships WHERE org_id = ? AND user_id = ?', orgId, result.userId);
    assert.equal(membership.role, 'admin');
  });
});

describe('email', () => {
  test('records every message even with no provider configured', async () => {
    const before = recentEmails(200).length;
    const result = await sendEmail({
      to: 'someone@example.com',
      template: 'password_reset',
      data: { resetUrl: 'https://curbcut.dev/reset-password?token=abc', expiresMinutes: 60 },
    });
    assert.equal(result.sent, false, 'nothing should actually be delivered without a key');
    assert.equal(result.mode, 'console');

    const after = recentEmails(200);
    assert.equal(after.length, before + 1);
    assert.equal(after[0].template, 'password_reset');
    assert.equal(after[0].status, 'logged');

    // The list view omits bodies on purpose; fetch the full row for content.
    const full = getEmail(result.id);
    assert.match(full.body_text, /curbcut\.dev\/reset-password/);
  });

  test('renders a subject and both body formats for each template', async () => {
    const sent = await sendEmail({
      to: 'x@example.com',
      template: 'scan_complete',
      data: {
        siteName: 'Shop', siteUrl: 'https://shop.example', score: 72, previousScore: 60,
        totals: { definite: 3, review: 5, advisory: 2 },
        reportUrl: 'https://curbcut.dev/app/scans/1', newIssues: 1, resolvedIssues: 4,
      },
    });
    const row = getEmail(sent.id);
    assert.match(row.subject, /new accessibility issue/i);
    assert.match(row.body_html, /<!DOCTYPE html>/);
    assert.match(row.body_text, /Shop scored 72\/100 \(up 12 points\)/);
  });

  test('an unknown template is a programming error, not a silent no-op', async () => {
    await assert.rejects(() => sendEmail({ to: 'a@b.co', template: 'nope' }), /Unknown email template/);
  });
});

describe('scheduled scans', () => {
  let siteId;
  let server;

  before(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/robots.txt') { res.writeHead(404).end(); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<!DOCTYPE html><html><head><title>S</title></head><body><main><h1>S</h1><img src="/a.jpg"></main></body></html>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

    siteId = randomUUID();
    run(
      `INSERT INTO sites (id, org_id, name, base_url, max_pages, created_at) VALUES (?, ?, ?, ?, 1, ?)`,
      siteId, orgId, 'Scheduled', `http://127.0.0.1:${server.address().port}`, new Date().toISOString()
    );
  });

  after(() => server?.close());

  test('plan gates the available cadences', () => {
    assert.equal(frequencyAllowed('free', 'daily'), false);
    assert.equal(frequencyAllowed('free', 'manual'), true);
    assert.equal(frequencyAllowed('starter', 'weekly'), true);
    assert.equal(frequencyAllowed('starter', 'daily'), false);
    assert.equal(frequencyAllowed('growth', 'daily'), true);
    assert.equal(frequencyAllowed('scale', 'sixhourly'), true);
  });

  test('setting a schedule computes the next run', () => {
    setSchedule(siteId, 'daily');
    const site = get('SELECT scan_frequency, next_scan_at FROM sites WHERE id = ?', siteId);
    assert.equal(site.scan_frequency, 'daily');
    assert.ok(site.next_scan_at);
    const hours = (new Date(site.next_scan_at) - Date.now()) / 3600_000;
    assert.ok(hours > 23 && hours < 25, `expected ~24h, got ${hours}`);
  });

  test('a site is not due before its time', () => {
    assert.equal(dueSites(new Date()).some((s) => s.id === siteId), false);
  });

  test('runs the scan when due and reschedules it', async () => {
    run('UPDATE sites SET next_scan_at = ? WHERE id = ?', new Date(Date.now() - 1000).toISOString(), siteId);
    assert.ok(dueSites(new Date()).some((s) => s.id === siteId), 'site should be due');

    const results = await tick();
    const mine = results.find((r) => r.siteId === siteId);
    assert.ok(mine?.ok, `expected the scheduled scan to run: ${JSON.stringify(mine)}`);

    const scan = get(`SELECT * FROM scans WHERE id = ?`, mine.scanId);
    assert.equal(scan.status, 'complete');
    assert.equal(scan.trigger, 'scheduled');

    // Rescheduled forward, so a failing site cannot spin in a hot loop.
    const site = get('SELECT next_scan_at FROM sites WHERE id = ?', siteId);
    assert.ok(new Date(site.next_scan_at) > new Date(), 'next run must be in the future');
  });

  test('downgrading the plan disables a cadence the account no longer has', async () => {
    run(`UPDATE orgs SET plan = 'free', trial_ends_at = NULL WHERE id = ?`, orgId);
    run('UPDATE sites SET next_scan_at = ?, scan_frequency = ? WHERE id = ?',
      new Date(Date.now() - 1000).toISOString(), 'daily', siteId);

    const results = await tick();
    assert.equal(results.find((r) => r.siteId === siteId)?.skipped, 'plan');

    const site = get('SELECT scan_frequency, next_scan_at FROM sites WHERE id = ?', siteId);
    assert.equal(site.scan_frequency, 'manual');
    assert.equal(site.next_scan_at, null);
  });
});
