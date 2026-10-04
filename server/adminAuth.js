import { randomBytes } from 'node:crypto';
import { db } from './db.js';
import { hashToken, newToken } from './util.js';
import { hashPassword, verifyPassword } from './password.js';

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h — short-lived on purpose, this is a privileged account
export const ADMIN_SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;

/** Create or reset the (single) admin account's password. Used by scripts/admin-set-password.mjs, never over HTTP. */
export function upsertAdminUser(username, password) {
  const passwordHash = hashPassword(password);
  db.prepare(
    `INSERT INTO admin_users (username, password_hash) VALUES (?, ?)
     ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash`
  ).run(username, passwordHash);
}

/** Verify credentials and, on success, issue a new admin session token. Returns null on failure. */
export function adminLogin(username, password) {
  const row = db.prepare('SELECT * FROM admin_users WHERE username = ?').get(username);
  // Run verifyPassword even when there's no matching row (against a dummy
  // hash) so a nonexistent username doesn't respond measurably faster than a
  // wrong password for a real one.
  const ok = verifyPassword(password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok) return null;

  const token = newToken(32);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  db.prepare(
    'INSERT INTO admin_sessions (token_hash, admin_user_id, expires_at) VALUES (?, ?, ?)'
  ).run(hashToken(token), row.id, expiresAt);
  return token;
}

const DUMMY_HASH = hashPassword(randomBytes(24).toString('hex'));

export function getAdminSessionUser(token) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT s.id AS sessionId, u.id, u.username FROM admin_sessions s
     JOIN admin_users u ON u.id = s.admin_user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`
  ).get(hashToken(token), Date.now());
  if (!row) return null;
  db.prepare(`UPDATE admin_sessions SET last_seen_at = datetime('now') WHERE id = ?`).run(row.sessionId);
  return { id: row.id, username: row.username };
}

export function revokeAdminSession(token) {
  if (!token) return;
  db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(hashToken(token));
}
