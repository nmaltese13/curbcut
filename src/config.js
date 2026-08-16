import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Load .env if present. Keeps local setup to a single file with zero dependencies.
const envPath = path.resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const rawLine of readFileSync(envPath, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const env = process.env;
const isProd = env.NODE_ENV === 'production';

// In production a missing session secret is fatal: a random secret per boot would
// silently sign out every user on each deploy and defeat session revocation.
function sessionSecret() {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  if (isProd) {
    throw new Error('SESSION_SECRET is required in production. Generate one with: openssl rand -hex 32');
  }
  return randomBytes(32).toString('hex');
}

export const config = {
  env: env.NODE_ENV || 'development',
  isProd,
  // 3300 rather than 3000, which is crowded on most development machines.
  port: Number(env.PORT || 3300),
  host: env.HOST || '127.0.0.1',
  appUrl: (env.APP_URL || `http://localhost:${Number(env.PORT || 3300)}`).replace(/\/$/, ''),
  databasePath: env.DATABASE_PATH || path.resolve(process.cwd(), 'data', 'curbcut.db'),
  sessionSecret: sessionSecret(),
  logLevel: env.LOG_LEVEL || (isProd ? 'info' : 'debug'),

  // Billing. Absent keys put the app in "local billing" mode where plan changes are
  // applied directly. The product is fully usable without Stripe configured.
  stripe: {
    secretKey: env.STRIPE_SECRET_KEY || null,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET || null,
    enabled: Boolean(env.STRIPE_SECRET_KEY),
  },

  // AI is an enhancement layer for fix suggestions, never a correctness dependency.
  // Every rule and every deterministic fix works with no key present.
  ai: {
    apiKey: env.ANTHROPIC_API_KEY || null,
    model: env.ANTHROPIC_MODEL || 'claude-sonnet-5',
    enabled: Boolean(env.ANTHROPIC_API_KEY),
  },

  // Outbound email. With no API key the app records messages to the outbox and
  // prints links to the console, so password reset and invites remain testable
  // without a provider account.
  email: {
    provider: (env.EMAIL_PROVIDER || 'resend').toLowerCase(),
    apiKey: env.EMAIL_API_KEY || null,
    from: env.EMAIL_FROM || 'Curbcut <notifications@curbcut.dev>',
  },

  // Background scheduler for recurring scans.
  scheduler: {
    enabled: env.SCHEDULER_ENABLED !== 'false',
    intervalMs: Number(env.SCHEDULER_INTERVAL_MS || 60_000),
    maxConcurrent: Number(env.SCHEDULER_MAX_CONCURRENT || 1),
  },

  // Headless rendering. `auto` uses a real browser when Playwright is installed
  // and silently falls back to fetching HTML when it is not, so the product
  // never depends on a browser being present.
  render: {
    mode: env.RENDER_MODE || 'auto', // auto | static | browser
    timeoutMs: Number(env.RENDER_TIMEOUT_MS || 20000),
    viewportWidth: Number(env.RENDER_VIEWPORT_WIDTH || 1280),
    viewportHeight: Number(env.RENDER_VIEWPORT_HEIGHT || 900),
  },

  crawler: {
    userAgent:
      env.CRAWLER_USER_AGENT ||
      'CurbcutBot/0.1 (+https://curbcut.dev/bot; accessibility scanner)',
    timeoutMs: Number(env.CRAWLER_TIMEOUT_MS || 15000),
    maxBytesPerPage: Number(env.CRAWLER_MAX_BYTES || 5_000_000),
    concurrency: Number(env.CRAWLER_CONCURRENCY || 4),
    politeDelayMs: Number(env.CRAWLER_DELAY_MS || 150),
  },

  // Anonymous scans are the top-of-funnel acquisition engine, so they are rate
  // limited per IP rather than gated behind signup.
  publicScan: {
    maxPages: Number(env.PUBLIC_SCAN_MAX_PAGES || 3),
    perHourPerIp: Number(env.PUBLIC_SCAN_PER_HOUR || 5),
  },
};

export default config;
