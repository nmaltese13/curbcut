import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import config from './config.js';
import log from './log.js';

mkdirSync(path.dirname(config.databasePath), { recursive: true });

export const db = new DatabaseSync(config.databasePath);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

// Migrations are append-only. Each entry runs once and is recorded, so deploying a
// newer build against an existing database is safe.
const MIGRATIONS = [
  {
    name: '001_core',
    sql: `
    CREATE TABLE orgs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      plan TEXT NOT NULL DEFAULT 'free',
      billing_status TEXT NOT NULL DEFAULT 'active',
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      trial_ends_at TEXT,
      legal_name TEXT,
      contact_email TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      name TEXT,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );

    CREATE TABLE memberships (
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL,
      PRIMARY KEY (org_id, user_id)
    );

    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      org_id TEXT REFERENCES orgs(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      ip TEXT,
      user_agent TEXT
    );
    CREATE INDEX idx_sessions_user ON sessions(user_id);

    CREATE TABLE sites (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      repo_url TEXT,
      repo_root TEXT,
      framework TEXT,
      scan_frequency TEXT NOT NULL DEFAULT 'manual',
      max_pages INTEGER NOT NULL DEFAULT 25,
      created_at TEXT NOT NULL,
      archived_at TEXT
    );
    CREATE INDEX idx_sites_org ON sites(org_id);

    CREATE TABLE scans (
      id TEXT PRIMARY KEY,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'queued',
      trigger TEXT NOT NULL DEFAULT 'manual',
      started_at TEXT,
      finished_at TEXT,
      pages_scanned INTEGER NOT NULL DEFAULT 0,
      score INTEGER,
      totals_json TEXT,
      coverage_json TEXT,
      error TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_scans_site ON scans(site_id, created_at DESC);

    CREATE TABLE scan_pages (
      id TEXT PRIMARY KEY,
      scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      status_code INTEGER,
      title TEXT,
      bytes INTEGER,
      render_mode TEXT,
      coverage_note TEXT,
      error TEXT,
      html TEXT
    );
    CREATE INDEX idx_pages_scan ON scan_pages(scan_id);

    CREATE TABLE findings (
      id TEXT PRIMARY KEY,
      scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
      page_id TEXT NOT NULL REFERENCES scan_pages(id) ON DELETE CASCADE,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      rule_id TEXT NOT NULL,
      wcag TEXT,
      level TEXT,
      impact TEXT NOT NULL,
      confidence TEXT NOT NULL,
      message TEXT NOT NULL,
      selector TEXT,
      snippet TEXT,
      line INTEGER,
      col INTEGER,
      signature TEXT NOT NULL,
      fix_kind TEXT,
      fix_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_findings_scan ON findings(scan_id);
    CREATE INDEX idx_findings_sig ON findings(site_id, signature);

    -- The durable ledger. Survives every rescan and is what makes the product
    -- expensive to leave: triage decisions and remediation history live here.
    CREATE TABLE finding_states (
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      signature TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      note TEXT,
      decided_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      resolved_at TEXT,
      resolved_scan_id TEXT,
      PRIMARY KEY (site_id, signature)
    );

    CREATE TABLE fixes (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      scan_id TEXT REFERENCES scans(id) ON DELETE SET NULL,
      signature TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      strategy TEXT NOT NULL,
      confidence TEXT NOT NULL,
      source_file TEXT,
      source_line INTEGER,
      before_text TEXT,
      after_text TEXT,
      diff TEXT,
      status TEXT NOT NULL DEFAULT 'proposed',
      created_at TEXT NOT NULL,
      applied_at TEXT,
      verified_scan_id TEXT
    );
    CREATE INDEX idx_fixes_site ON fixes(site_id, created_at DESC);

    CREATE TABLE evidence_docs (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1,
      scan_id TEXT REFERENCES scans(id) ON DELETE SET NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL
    );
    CREATE INDEX idx_evidence_site ON evidence_docs(site_id, kind, version DESC);

    CREATE TABLE api_keys (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      last_used_at TEXT,
      revoked_at TEXT
    );
    CREATE INDEX idx_apikeys_org ON api_keys(org_id);

    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      org_id TEXT,
      user_id TEXT,
      name TEXT NOT NULL,
      props_json TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_events_name ON events(name, created_at DESC);

    CREATE TABLE audit_log (
      id TEXT PRIMARY KEY,
      org_id TEXT,
      user_id TEXT,
      action TEXT NOT NULL,
      target TEXT,
      meta_json TEXT,
      ip TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_audit_org ON audit_log(org_id, created_at DESC);

    CREATE TABLE usage_counters (
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      period TEXT NOT NULL,
      metric TEXT NOT NULL,
      value INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (org_id, period, metric)
    );

    -- Anonymous funnel: every free scan is a lead record.
    CREATE TABLE public_scans (
      id TEXT PRIMARY KEY,
      url TEXT NOT NULL,
      score INTEGER,
      totals_json TEXT,
      findings_json TEXT,
      coverage_json TEXT,
      email TEXT,
      ip_hash TEXT,
      converted_org_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_public_scans_created ON public_scans(created_at DESC);
    CREATE INDEX idx_public_scans_ip ON public_scans(ip_hash, created_at DESC);
  `,
  },

  {
    name: '002_service_requests',
    sql: `
    -- Managed services: the customer asks us to do the audit or the fixing.
    -- Software margins fund the company; services close the gap between what
    -- automation can prove and what a procurement team will accept.
    CREATE TABLE service_requests (
      id TEXT PRIMARY KEY,
      org_id TEXT REFERENCES orgs(id) ON DELETE SET NULL,
      site_id TEXT REFERENCES sites(id) ON DELETE SET NULL,
      scan_id TEXT REFERENCES scans(id) ON DELETE SET NULL,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      contact_name TEXT,
      contact_email TEXT NOT NULL,
      company TEXT,
      site_url TEXT,
      notes TEXT,
      internal_notes TEXT,
      quoted_amount INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );
    CREATE INDEX idx_service_requests_status ON service_requests(status, created_at DESC);
    CREATE INDEX idx_service_requests_org ON service_requests(org_id, created_at DESC);
  `,
  },

  {
    name: '003_accounts_and_email',
    sql: `
    -- Every message is recorded whether or not a provider is configured, so
    -- nothing is silently lost and support can see exactly what a user received.
    CREATE TABLE email_outbox (
      id TEXT PRIMARY KEY,
      to_email TEXT NOT NULL,
      subject TEXT NOT NULL,
      template TEXT NOT NULL,
      body_html TEXT,
      body_text TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      provider TEXT,
      provider_id TEXT,
      error TEXT,
      org_id TEXT,
      created_at TEXT NOT NULL,
      sent_at TEXT
    );
    CREATE INDEX idx_outbox_created ON email_outbox(created_at DESC);
    CREATE INDEX idx_outbox_status ON email_outbox(status, created_at DESC);

    -- Tokens are stored hashed. A leaked database must not hand over the
    -- ability to take over accounts.
    CREATE TABLE password_resets (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      requested_ip TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_password_resets_user ON password_resets(user_id);

    CREATE TABLE invitations (
      token_hash TEXT PRIMARY KEY,
      org_id TEXT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      invited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX idx_invitations_org ON invitations(org_id, created_at DESC);

    -- Scheduling state lives on the site so the scheduler is a simple query.
    ALTER TABLE sites ADD COLUMN next_scan_at TEXT;
    ALTER TABLE sites ADD COLUMN notify_emails INTEGER NOT NULL DEFAULT 1;
    CREATE INDEX idx_sites_next_scan ON sites(next_scan_at) WHERE next_scan_at IS NOT NULL;
  `,
  },
];

db.exec(`CREATE TABLE IF NOT EXISTS migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
)`);

const applied = new Set(db.prepare('SELECT name FROM migrations').all().map((r) => r.name));

for (const migration of MIGRATIONS) {
  if (applied.has(migration.name)) continue;
  db.exec('BEGIN');
  try {
    db.exec(migration.sql);
    db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(
      migration.name,
      new Date().toISOString()
    );
    db.exec('COMMIT');
    log.info('migration applied', { name: migration.name });
  } catch (err) {
    db.exec('ROLLBACK');
    log.error('migration failed', { name: migration.name, error: err.message });
    throw err;
  }
}

export function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}

export function get(sql, ...params) {
  return db.prepare(sql).get(...params);
}

export function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}

export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export default db;
