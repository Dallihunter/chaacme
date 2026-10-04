import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

// Shared by adminAuth.js (admin_users.password_hash) and auth.js
// (users.password_hash) — same scrypt shape for both account systems.
const SCRYPT_KEYLEN = 64;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [saltHex, hashHex] = String(stored || '').split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const got = scryptSync(password, salt, expected.length);
  return got.length === expected.length && timingSafeEqual(got, expected);
}
