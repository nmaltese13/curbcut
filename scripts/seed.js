/**
 * Create a demo account so the app can be explored immediately.
 * Usage: npm run seed
 */
import { randomUUID } from 'node:crypto';
import { get, run } from '../src/db.js';
import { registerUser } from '../src/auth.js';
import config from '../src/config.js';

const EMAIL = process.env.SEED_EMAIL || 'founder@curbcut.dev';
const PASSWORD = process.env.SEED_PASSWORD || 'curbcut-demo-2026';

async function main() {
  let user = get('SELECT * FROM users WHERE email = ?', EMAIL);
  let orgId;

  if (user) {
    orgId = get('SELECT org_id FROM memberships WHERE user_id = ?', user.id)?.org_id;
    console.log(`Demo user already exists: ${EMAIL}`);
  } else {
    const result = await registerUser({
      email: EMAIL,
      password: PASSWORD,
      name: 'Demo Founder',
      orgName: 'Curbcut Demo',
    });
    orgId = result.orgId;
    run('UPDATE users SET is_admin = 1 WHERE id = ?', result.userId);
    run(`UPDATE orgs SET plan = 'growth', legal_name = 'Curbcut Demo Ltd', contact_email = ? WHERE id = ?`, EMAIL, orgId);
    console.log(`Created admin user ${EMAIL} with password: ${PASSWORD}`);
  }

  // Point the demo site at this running instance so a scan works offline.
  const existing = get('SELECT id FROM sites WHERE org_id = ? LIMIT 1', orgId);
  if (!existing) {
    const siteId = randomUUID();
    run(
      `INSERT INTO sites (id, org_id, name, base_url, max_pages, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      siteId, orgId, 'Curbcut (self-scan)', config.appUrl, 15, new Date().toISOString()
    );
    console.log(`Added demo site pointing at ${config.appUrl}`);
  }

  console.log('\nStart the server with:  npm start');
  console.log(`Then sign in at ${config.appUrl}/login`);
  console.log(`  email:    ${EMAIL}`);
  console.log(`  password: ${PASSWORD}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
