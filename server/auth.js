import { randomInt, randomBytes } from 'node:crypto';
import { db } from './db.js';
import { hashOtp, hashToken, newToken } from './util.js';
import { hashPassword, verifyPassword } from './password.js';

const OTP_TTL_MS = 2 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const SIGNUP_TICKET_TTL_MS = 15 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const OTP_TTL_SECONDS = OTP_TTL_MS / 1000;

function generateCode() {
  return String(randomInt(0, 100000)).padStart(5, '0');
}

/**
 * Delivers an OTP code to a phone number.
 *
 * There is no real SMS vendor wired up (no credentials were provided for
 * this project) — this posts to a generic webhook so any provider can be
 * plugged in behind a thin adapter, and falls back to logging the code to
 * the console outside production. assertRuntimeConfig() in util.js refuses
 * to boot in production without SMS_WEBHOOK_URL set, so the console branch
 * is unreachable there — see server/util.js.
 */
export async function sendOtp(phone, code) {
  const webhook = (process.env.SMS_WEBHOOK_URL || '').trim();
  if (!webhook) {
    console.log(`[chaacme-platform] DEV OTP for ${phone}: ${code} (no SMS_WEBHOOK_URL configured)`);
    return;
  }
  const apiKey = (process.env.SMS_API_KEY || '').trim();
  const res = await fetch(webhook, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
    },
    body: JSON.stringify({ phone, code })
  });
  if (!res.ok) throw new Error(`sms webhook responded ${res.status}`);
}

/** Issue a fresh OTP for a phone number. Caller is responsible for rate limiting. */
export async function issueOtp(phone) {
  const code = generateCode();
  const expiresAt = Date.now() + OTP_TTL_MS;
  db.prepare(
    `INSERT INTO otp_codes (phone, code_hash, max_attempts, expires_at) VALUES (?, ?, ?, ?)`
  ).run(phone, hashOtp(phone, code), OTP_MAX_ATTEMPTS, expiresAt);
  await sendOtp(phone, code);
  return { expiresInSeconds: OTP_TTL_SECONDS };
}

/**
 * Verify a code against the most recent unconsumed OTP for that phone.
 * Returns one of:
 *   { ok:false, error }
 *   { ok:true, status:'existing', user, sessionToken }
 *   { ok:true, status:'new', ticket, expiresInSeconds }
 */
export function verifyOtp(phone, code) {
  const row = db.prepare(
    `SELECT * FROM otp_codes WHERE phone = ? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1`
  ).get(phone);
  if (!row) return { ok: false, error: 'no_code' };
  if (Date.now() > row.expires_at) return { ok: false, error: 'expired' };
  if (row.attempts >= row.max_attempts) return { ok: false, error: 'too_many_attempts' };

  if (row.code_hash !== hashOtp(phone, code)) {
    db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    return { ok: false, error: 'invalid_code' };
  }

  db.prepare(`UPDATE otp_codes SET consumed_at = datetime('now') WHERE id = ?`).run(row.id);

  const user = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  if (user) {
    const sessionToken = createSession(user.id);
    return { ok: true, status: 'existing', user: publicUser(user), sessionToken };
  }

  const ticket = newToken(24);
  const expiresAt = Date.now() + SIGNUP_TICKET_TTL_MS;
  db.prepare(
    'INSERT INTO signup_tickets (token_hash, phone, expires_at) VALUES (?, ?, ?)'
  ).run(hashToken(ticket), phone, expiresAt);
  return { ok: true, status: 'new', ticket, expiresInSeconds: SIGNUP_TICKET_TTL_MS / 1000 };
}

/**
 * Redeem a signup ticket (proof of phone ownership from verifyOtp) and create
 * the account. Returns { ok:true, user, sessionToken } or { ok:false, error }.
 */
export function completeProfile(ticket, { firstName, lastName, username }) {
  const row = db.prepare(
    'SELECT * FROM signup_tickets WHERE token_hash = ? AND consumed_at IS NULL'
  ).get(hashToken(String(ticket || '')));
  if (!row) return { ok: false, error: 'invalid_ticket' };
  if (Date.now() > row.expires_at) return { ok: false, error: 'ticket_expired' };

  db.prepare(`UPDATE signup_tickets SET consumed_at = datetime('now') WHERE id = ?`).run(row.id);

  // Phone is unique too, but a ticket only ever exists for a phone that had
  // no user row at verify time, so this only fires on a genuine race.
  const existing = db.prepare('SELECT id FROM users WHERE phone = ? OR username = ?').get(row.phone, username);
  if (existing) return { ok: false, error: 'already_exists' };

  const info = db.prepare(
    'INSERT INTO users (phone, first_name, last_name, username) VALUES (?, ?, ?, ?)'
  ).run(row.phone, firstName, lastName, username);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
  const sessionToken = createSession(user.id);
  return { ok: true, user: publicUser(user), sessionToken };
}

/**
 * Single-step signup with a password (no ticket bridge needed — unlike OTP,
 * the password itself is the proof, there's nothing external to verify
 * first). Returns { ok:true, user, sessionToken } or { ok:false, error }.
 */
export function signupWithPassword({ phone, firstName, lastName, username, password }) {
  const existing = db.prepare('SELECT id FROM users WHERE phone = ? OR username = ?').get(phone, username);
  if (existing) return { ok: false, error: 'already_exists' };

  const passwordHash = hashPassword(password);
  const info = db.prepare(
    'INSERT INTO users (phone, first_name, last_name, username, password_hash) VALUES (?, ?, ?, ?, ?)'
  ).run(phone, firstName, lastName, username, passwordHash);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
  const sessionToken = createSession(user.id);
  return { ok: true, user: publicUser(user), sessionToken };
}

// Verified against on a missing user / OTP-only user (no password_hash) so
// those cases take the same time as a wrong password for a real account —
// same timing-attack mitigation as adminAuth.js's DUMMY_HASH.
const DUMMY_PASSWORD_HASH = hashPassword(randomBytes(24).toString('hex'));

/** Returns { ok:true, user, sessionToken } or { ok:false, error:'invalid_credentials' } — never distinguishes wrong-password from unknown-phone. */
export function loginWithPassword(phone, password) {
  const row = db.prepare('SELECT * FROM users WHERE phone = ?').get(phone);
  const ok = verifyPassword(password, row && row.password_hash ? row.password_hash : DUMMY_PASSWORD_HASH);
  if (!row || !row.password_hash || !ok) return { ok: false, error: 'invalid_credentials' };

  const sessionToken = createSession(row.id);
  return { ok: true, user: publicUser(row), sessionToken };
}

export function createSession(userId) {
  const token = newToken(32);
  const expiresAt = Date.now() + SESSION_TTL_MS;
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'
  ).run(hashToken(token), userId, expiresAt);
  return token;
}

export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;

export function getSessionUser(token) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT s.id AS sessionId, u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > ?`
  ).get(hashToken(token), Date.now());
  if (!row) return null;
  db.prepare(`UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?`).run(row.sessionId);
  return publicUser(row);
}

export function revokeSession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

function publicUser(row) {
  return {
    id: row.id, phone: row.phone, firstName: row.first_name, lastName: row.last_name,
    username: row.username, status: row.status
  };
}
