// Creates the admin account, or resets its password if it already exists.
// Run on the host (or against a local dev DB) — never exposed over HTTP.
//
//   node scripts/admin-set-password.mjs <username> <password>
//   npm run admin:set-password -- <username> <password>
import { upsertAdminUser } from '../server/adminAuth.js';

const [, , username, password] = process.argv;

if (!username || !password) {
  console.error('usage: node scripts/admin-set-password.mjs <username> <password>');
  process.exit(1);
}
if (password.length < 10) {
  console.error('password must be at least 10 characters');
  process.exit(1);
}

upsertAdminUser(username, password);
console.log(`admin user "${username}" is set.`);
