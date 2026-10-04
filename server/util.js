import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { db } from './db.js';
import { isSandbox, looksLikeMerchantId } from './zarinpal.js';

export function json(res, status, payload, headers = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...headers
  });
  res.end(body);
}

/** Read a JSON body with a hard size cap. Returns {ok, value|error}. */
export function readJson(req, limitBytes = 32 * 1024) {
  return new Promise((resolve) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        resolve({ ok: false, error: 'payload_too_large' });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({ ok: true, value: {} });
      try {
        resolve({ ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      } catch {
        resolve({ ok: false, error: 'invalid_json' });
      }
    });
    req.on('error', () => resolve({ ok: false, error: 'read_error' }));
  });
}

// --- client IP (ported from the marketing site's server/util.js: same
// reasoning applies verbatim — XFF is only trusted from a loopback peer) ----

export function normaliseIp(value) {
  if (value == null) return '';
  let ip = String(value).trim();
  if (ip.startsWith('[')) {
    const end = ip.indexOf(']');
    if (end > 0) ip = ip.slice(1, end);
  }
  const mapped = /^::ffff:((?:\d{1,3}\.){3}\d{1,3})$/i.exec(ip);
  if (mapped) ip = mapped[1];
  return ip;
}

export function isLoopback(value) {
  const ip = normaliseIp(value);
  return ip === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);
}

export function clientIp(req) {
  const socketIp = normaliseIp(req.socket?.remoteAddress);
  if (!socketIp) return 'unknown';
  if (!isLoopback(socketIp)) return socketIp;

  const raw = req.headers?.['x-forwarded-for'];
  const header = Array.isArray(raw) ? raw.join(',') : raw;
  if (typeof header !== 'string' || header.trim() === '') return socketIp;

  const first = normaliseIp(header.split(',')[0]);
  return first || socketIp;
}

// --- secrets ---------------------------------------------------------------
//
// Same policy as the marketing site: no fallback secret anywhere in the
// source. A missing secret is a hard failure in every environment rather than
// an insecure default, so there's nothing to silently get wrong on deploy.

const MISSING = (name, example) =>
  `${name} is not set, and there is no fallback by design.\n`
  + `    development:  ${name}="$(openssl rand -base64 32)" npm start\n`
  + `    production:   set it in the service's env file (see deploy/env.example)${example || ''}`;

function secret(name) {
  const value = (process.env[name] || '').trim();
  if (!value) throw new Error(MISSING(name));
  return value;
}

export function hashIp(ip) {
  return createHash('sha256').update(secret('IP_HASH_SALT') + ip).digest('hex').slice(0, 32);
}

/** Peppered hash for low-entropy secrets (OTP codes) that must resist offline brute force even if the DB leaks. */
export function hashOtp(phone, code) {
  return createHash('sha256').update(secret('OTP_PEPPER') + ':' + phone + ':' + code).digest('hex');
}

/** Plain SHA-256 is fine for high-entropy random tokens (sessions, signup tickets) — no pepper needed. */
export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(bytes = 32) {
  return randomBytes(bytes).toString('hex');
}

export const newRef = () => randomUUID().slice(0, 8).toUpperCase();

function fingerprint(label, value) {
  return createHash('sha256').update(`chaacme-platform-fingerprint:${label}:${value}`).digest('hex').slice(0, 8);
}

export function describeRuntimeConfig(env = process.env) {
  const nodeEnv = (env.NODE_ENV || '').trim();
  const salt = (env.IP_HASH_SALT || '').trim();
  const pepper = (env.OTP_PEPPER || '').trim();
  const smsWebhook = (env.SMS_WEBHOOK_URL || '').trim();

  return [
    `NODE_ENV=${nodeEnv || '(unset)'} — secret checks ${nodeEnv === 'production' ? 'strict' : 'advisory'}`,
    salt
      ? `IP_HASH_SALT from environment (${salt.length} chars, fingerprint ${fingerprint('salt', salt)})`
      : 'IP_HASH_SALT NOT SET — there is no fallback; IP hashing would throw',
    pepper
      ? `OTP_PEPPER from environment (${pepper.length} chars, fingerprint ${fingerprint('pepper', pepper)})`
      : 'OTP_PEPPER NOT SET — there is no fallback; OTP issuance would throw',
    'ADMIN_TOKEN — no longer used; /api/admin/* now authenticates via POST /api/admin/login (see scripts/admin-set-password.mjs to create the account)',
    (() => {
      const pol = cookiePolicy(env);
      const origins = allowedOrigins(env);
      return `cookies: admin HttpOnly${pol.secure ? '; Secure' : ''}; SameSite=Strict; Path=${ADMIN_COOKIE_PATH} | user HttpOnly${pol.secure ? '; Secure' : ''}; SameSite=${pol.userSameSite}; Path=/`
        + ` | state-changing /api requests must come from ${origins ? [...origins].join(', ') : 'the same host (FRONTEND_ORIGIN unset: local development only)'}`;
    })(),
    smsWebhook
      ? `SMS_WEBHOOK_URL set — OTP codes are delivered by POSTing to it`
      : `SMS_WEBHOOK_URL NOT SET — OTP codes ${nodeEnv === 'production' ? 'cannot be delivered (see below)' : 'are logged to the console (dev only)'}`,
    (() => {
      const sandbox = isSandbox(env);
      const merchantId = (env.ZARINPAL_MERCHANT_ID || '').trim();
      const callback = (env.ZARINPAL_CALLBACK_URL || '').trim();
      return `ZARINPAL_SANDBOX=${sandbox} — merchant id ${merchantId ? (looksLikeMerchantId(merchantId) ? 'set' : 'set but not UUID-shaped') : 'NOT SET'}, `
        + `callback url ${callback || 'NOT SET'}`;
    })()
  ];
}

/**
 * Check secrets before the server starts listening. Returns {problems, warnings};
 * the caller exits on any problem.
 */
export function assertRuntimeConfig(env = process.env) {
  const problems = [];
  const warnings = [];
  const salt = (env.IP_HASH_SALT || '').trim();
  const pepper = (env.OTP_PEPPER || '').trim();
  const smsWebhook = (env.SMS_WEBHOOK_URL || '').trim();
  const production = env.NODE_ENV === 'production';

  // Cookie hardening and the cross-site write guard must not be weakened in
  // production. (The secure behaviour itself never depends on NODE_ENV; this
  // only refuses the dev-only overrides when NODE_ENV says it is production.)
  const cookies = cookiePolicy(env);
  for (const note of cookies.notes) { if (cookies.overridden && production) problems.push(note); else warnings.push(note); }
  if (!allowedOrigins(env)) {
    const msg = 'FRONTEND_ORIGIN is not set: the cross-site write guard compares the Origin host with the request Host, '
      + 'which DNS rebinding defeats. Set FRONTEND_ORIGIN to the site origin (https://...) outside local development.';
    if (production) problems.push(msg); else warnings.push(msg);
  }

  if (!salt) problems.push(MISSING('IP_HASH_SALT'));
  else if (salt.length < 16) {
    const msg = `IP_HASH_SALT is only ${salt.length} characters; use at least 16 (openssl rand -base64 32).`;
    if (production) problems.push(msg); else warnings.push(msg);
  }

  if (!pepper) problems.push(MISSING('OTP_PEPPER'));
  else if (pepper.length < 16) {
    const msg = `OTP_PEPPER is only ${pepper.length} characters; use at least 16 (openssl rand -base64 32).`;
    if (production) problems.push(msg); else warnings.push(msg);
  }

  if (production) {
    // Logging a real OTP code to stdout/journal in production hands account
    // takeover to anyone who can read the log, so — unlike ADMIN_TOKEN — this
    // is a hard failure, not a warning, once NODE_ENV says "production".
    if (!smsWebhook) {
      problems.push('SMS_WEBHOOK_URL is not set. In production, OTP codes are never logged to the console — '
        + 'configure an SMS delivery webhook (see deploy/env.example) before going live.');
    }
  } else {
    warnings.push(`NODE_ENV is ${env.NODE_ENV ? `"${env.NODE_ENV}"` : 'unset'}, not "production" — length checks are `
      + 'advisory, and OTP codes print to the console instead of being sent.');
  }

  // ZarinPal: sandbox is the safe default, so a missing/placeholder merchant
  // id there is only a warning (any UUID-shaped placeholder works against
  // ZarinPal's sandbox API). The moment ZARINPAL_SANDBOX=false, though, a
  // missing or fake-looking merchant id is a hard failure — same reasoning
  // as SMS_WEBHOOK_URL above: better to refuse to boot than silently take
  // real payments against a broken config.
  const zarinpalSandbox = isSandbox(env);
  const zarinpalMerchantId = (env.ZARINPAL_MERCHANT_ID || '').trim();
  const zarinpalCallbackUrl = (env.ZARINPAL_CALLBACK_URL || '').trim();

  if (!zarinpalSandbox) {
    if (!zarinpalMerchantId || !looksLikeMerchantId(zarinpalMerchantId)) {
      problems.push('ZARINPAL_SANDBOX is false (live ZarinPal) but ZARINPAL_MERCHANT_ID is missing or not a '
        + 'real merchant id (expected UUID format). Set the real merchant id ZarinPal issued you, or leave '
        + 'ZARINPAL_SANDBOX unset/true to keep testing against the sandbox.');
    }
  } else if (!zarinpalMerchantId) {
    warnings.push('ZARINPAL_MERCHANT_ID is not set — ZarinPal sandbox payment requests will fail until a '
      + 'UUID-shaped placeholder (or a real merchant id) is set.');
  } else if (!looksLikeMerchantId(zarinpalMerchantId)) {
    warnings.push('ZARINPAL_MERCHANT_ID does not look like a UUID — ZarinPal expects a UUID-shaped merchant id.');
  }

  if (!zarinpalCallbackUrl) {
    const msg = 'ZARINPAL_CALLBACK_URL is not set — ZarinPal payment requests have nowhere to send the user back to.';
    if (production) problems.push(msg); else warnings.push(msg);
  } else if (!/^https?:\/\//i.test(zarinpalCallbackUrl)) {
    problems.push('ZARINPAL_CALLBACK_URL must be an absolute http(s) URL.');
  }

  return { problems, warnings };
}

// --- cookies -----------------------------------------------------------

/**
 * Parses the Cookie header. If a name appears more than once the FIRST one wins:
 * browsers send the cookie with the longest (most specific) Path first, and the
 * admin cookie exists both at its current Path=/api/admin and, until it expires,
 * at the legacy Path=/ -- the current one must be the one that is read.
 */
export function parseCookies(req) {
  const header = req.headers?.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!name || Object.hasOwn(out, name)) continue;
    try { out[name] = decodeURIComponent(value); } catch { out[name] = value; }
  }
  return out;
}

export const USER_COOKIE = 'chaacme_session';
export const ADMIN_COOKIE = 'chaacme_admin_session';
// The admin panel is a same-origin page that only ever calls /api/admin/*, so
// the admin cookie is never sent anywhere else.
export const ADMIN_COOKIE_PATH = '/api/admin';

const FALSE_WORDS = new Set(['false', '0', 'no', 'off']);

/**
 * Cookie attribute policy. The defaults are the secure ones and DO NOT depend on
 * NODE_ENV or FRONTEND_ORIGIN (they used to: setting FRONTEND_ORIGIN switched the
 * session cookie to SameSite=None, which is what let a cross-site page ride a
 * logged-in session). The two overrides exist for local development only
 * (plain-http dev servers); they are refused when NODE_ENV=production and warned
 * about loudly otherwise.
 *   admin cookie: HttpOnly; Secure; SameSite=Strict; Path=/api/admin   (SameSite never overridable)
 *   user cookie:  HttpOnly; Secure; SameSite=Lax; Path=/
 */
export function cookiePolicy(env = process.env) {
  const secureRaw = (env.COOKIE_SECURE ?? '').trim().toLowerCase();
  const sameSiteRaw = (env.COOKIE_SAMESITE ?? '').trim().toLowerCase();
  const secure = !FALSE_WORDS.has(secureRaw);                       // only an explicit "false" turns it off
  const userSameSite = ['lax', 'strict', 'none'].includes(sameSiteRaw) ? sameSiteRaw : 'lax';
  const notes = [];
  if (!secure) notes.push('COOKIE_SECURE is off: session cookies are sent over plain HTTP (local development only)');
  if (sameSiteRaw && !['lax', 'strict', 'none'].includes(sameSiteRaw)) notes.push(`COOKIE_SAMESITE=${sameSiteRaw} is not lax|strict|none and is ignored (using lax)`);
  else if (userSameSite !== 'lax') notes.push(`COOKIE_SAMESITE=${userSameSite} weakens/changes the user session cookie (local development only)`);
  if (userSameSite === 'none' && !secure) notes.push('SameSite=None without Secure is rejected by browsers');
  return { secure, userSameSite, overridden: !secure || userSameSite !== 'lax', notes };
}

/** Builds a Set-Cookie header value for the user session or the admin session. */
export function sessionCookie(token, { maxAgeSeconds, clear = false, kind = 'user' } = {}) {
  const pol = cookiePolicy();
  const admin = kind === 'admin';
  const parts = [
    `${admin ? ADMIN_COOKIE : USER_COOKIE}=${clear ? '' : encodeURIComponent(token)}`,
    `Path=${admin ? ADMIN_COOKIE_PATH : '/'}`, 'HttpOnly',
    `SameSite=${admin ? 'Strict' : pol.userSameSite[0].toUpperCase() + pol.userSameSite.slice(1)}`
  ];
  if (pol.secure) parts.push('Secure');
  parts.push(clear ? 'Max-Age=0' : `Max-Age=${maxAgeSeconds}`);
  return parts.join('; ');
}

/**
 * Deletes the admin cookie as it used to be issued (Path=/). Sent with every admin
 * login and logout so a browser that still holds the old SameSite=None cookie
 * drops it instead of sending it alongside the new one.
 */
export function legacyAdminCookieClear() {
  const parts = [`${ADMIN_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (cookiePolicy().secure) parts.push('Secure');
  parts.push('Max-Age=0');
  return parts.join('; ');
}

// --- cross-site request forgery guard -----------------------------------------
//
// Every state-changing request to /api/* (POST/PUT/PATCH/DELETE) must come from
// our own frontend. Cookies are SameSite-restricted, but that is a second layer:
// this is the first. Nothing is exempt: the ZarinPal return is a GET (it changes
// state only through its own authority/verify handshake, never through a cookie)
// and so is not covered by, or in need of, this check.

export const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// The only two routes that take multipart/form-data (image uploads).
const MULTIPART_ROUTES = [/^\/api\/admin\/upload$/, /^\/api\/partner\/profiles\/[a-z0-9-]+\/upload$/];

/**
 * Origins allowed to send state-changing requests: FRONTEND_ORIGIN and its
 * www / non-www twin (https://chaacme.ir and https://www.chaacme.ir). Returns
 * null when FRONTEND_ORIGIN is not set.
 */
export function allowedOrigins(env = process.env) {
  const configured = (env.FRONTEND_ORIGIN || '').trim().replace(/\/+$/, '');
  if (!configured) return null;
  const out = new Set([configured]);
  try {
    const u = new URL(configured);
    const host = u.hostname;
    if (host.includes('.') && !/^[0-9.]+$/.test(host) && !host.includes(':')) {
      const twin = host.startsWith('www.') ? host.slice(4) : `www.${host}`;
      out.add(`${u.protocol}//${twin}${u.port ? `:${u.port}` : ''}`);
    }
  } catch { /* an unparsable FRONTEND_ORIGIN simply allows only itself */ }
  return out;
}

function sameHost(origin, hostHeader) {
  try { return !!hostHeader && new URL(origin).host.toLowerCase() === String(hostHeader).toLowerCase(); } catch { return false; }
}

/**
 * Decides whether a state-changing request is from our frontend.
 *  1. An Origin header, if present, must be in the allowlist (the string "null" is not).
 *  2. With no Origin, the Referer's origin must be in the allowlist.
 *  3. With neither, reject.
 * With FRONTEND_ORIGIN unset (local development) "in the allowlist" means "has the
 * same host as this request's Host header"; production must set FRONTEND_ORIGIN,
 * because that fallback is defeated by DNS rebinding.
 */
export function checkWriteOrigin(req, env = process.env) {
  const allowed = allowedOrigins(env);
  const ok = (o) => (allowed ? allowed.has(o) : sameHost(o, req.headers?.host));
  const origin = req.headers?.origin;
  if (origin !== undefined) return ok(origin) ? { ok: true } : { ok: false, reason: 'origin_not_allowed' };
  const referer = req.headers?.referer;
  if (referer) {
    let o;
    try { o = new URL(referer).origin; } catch { return { ok: false, reason: 'referer_unparseable' }; }
    return ok(o) ? { ok: true } : { ok: false, reason: 'referer_not_allowed' };
  }
  return { ok: false, reason: 'no_origin_or_referer' };
}

function mediaType(req) {
  return String(req.headers?.['content-type'] || '').split(';')[0].trim().toLowerCase();
}

/**
 * The whole guard for one request. Returns { ok: true } or { ok: false, status, error }.
 * Origin first (403), then Content-Type (415): JSON endpoints accept only
 * application/json, so a cross-site page cannot reach them with a "simple"
 * request (no preflight); the two upload routes accept only multipart/form-data.
 */
export function guardStateChange(req, pathname, env = process.env) {
  if (!STATE_CHANGING_METHODS.has(req.method) || !pathname.startsWith('/api/')) return { ok: true };
  const origin = checkWriteOrigin(req, env);
  if (!origin.ok) return { ok: false, status: 403, error: 'forbidden_origin', reason: origin.reason };
  const type = mediaType(req);
  if (MULTIPART_ROUTES.some((re) => re.test(pathname))) {
    return type === 'multipart/form-data' ? { ok: true } : { ok: false, status: 415, error: 'unsupported_media_type' };
  }
  const cl = req.headers?.['content-length'];
  const hasBody = (cl !== undefined && cl !== '0') || req.headers?.['transfer-encoding'] !== undefined;
  if ((hasBody || type) && type !== 'application/json') return { ok: false, status: 415, error: 'unsupported_media_type' };
  return { ok: true };
}

// --- rate limiting -----------------------------------------------------

/** Fixed-window rate limit persisted in SQLite. Returns true when allowed. */
export function allow(bucket, max, windowMs) {
  const now = Date.now();
  const row = db.prepare('SELECT hits, window_start FROM rate_limit WHERE bucket = ?').get(bucket);
  if (!row || now - row.window_start >= windowMs) {
    db.prepare(
      `INSERT INTO rate_limit (bucket, hits, window_start) VALUES (?, 1, ?)
       ON CONFLICT(bucket) DO UPDATE SET hits = 1, window_start = excluded.window_start`
    ).run(bucket, now);
    return true;
  }
  if (row.hits >= max) return false;
  db.prepare('UPDATE rate_limit SET hits = hits + 1 WHERE bucket = ?').run(bucket);
  return true;
}

// --- phone + input validation -------------------------------------------

/** Accepts 09xxxxxxxxx, +989xxxxxxxxx, 989xxxxxxxxx, 00989xxxxxxxxx; normalises to 09xxxxxxxxx. */
export function normalisePhone(input) {
  const digits = String(input || '').replace(/\D/g, '');
  const m = /^(?:0098|98|0)?(9\d{9})$/.exec(digits);
  return m ? '0' + m[1] : null;
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');

export function validateProfile(input) {
  const errors = {};
  const firstName = str(input.firstName);
  const lastName = str(input.lastName);
  const username = str(input.username);

  if (firstName.length < 1 || firstName.length > 60) errors.firstName = 'length';
  if (lastName.length < 1 || lastName.length > 60) errors.lastName = 'length';
  if (!/^[a-zA-Z0-9_.]{3,30}$/.test(username)) errors.username = 'format';

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { firstName, lastName, username } };
}

export function validatePassword(input) {
  const password = typeof input === 'string' ? input : '';
  if (password.length < 8 || password.length > 200) return { ok: false, errors: { password: 'length' } };
  return { ok: true, value: password };
}

export function validateReview(input) {
  const errors = {};
  const rating = Number(input.rating);
  const body = str(input.body);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) errors.rating = 'range';
  if (body.length < 4 || body.length > 2000) errors.body = 'length';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { rating, body } };
}

// --- hosts (organizers) --------------------------------------------------

/** Same shape as a tour id (TOUR_ID_RE in api.js): lowercase, digits, single hyphens. Entered by hand, so it must also be safe as a URL segment and as an upload directory name. */
export const HOST_SLUG_RE = /^[a-z0-9-]{2,40}$/;

/** Bare Instagram handle — no @, no URL, no slashes. Stored as-is; the frontend builds the profile URL from it. */
const INSTAGRAM_RE = /^[A-Za-z0-9._]{1,30}$/;

export function isValidHostSlug(slug) {
  return typeof slug === 'string' && HOST_SLUG_RE.test(slug);
}

/**
 * Accepts a bare handle, a leading @, or a full instagram URL, and returns
 * the bare handle. Returns null when there's nothing usable, so callers
 * store NULL rather than a half-parsed string.
 */
function normaliseInstagram(input) {
  let v = str(input);
  if (!v) return null;
  v = v.replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/\/+$/, '');
  if (!v) return null;
  return INSTAGRAM_RE.test(v) ? v : false; // false === present but invalid
}

// Matches exactly what the upload endpoint returns for a host photo. Anchored
// at both ends, no "." or ".." segment, and no scheme or "//" — so it can
// never become an
// absolute or protocol-relative URL.
const HOST_PHOTO_PATH_RE = /^\/images(?:\/(?!\.\.?(?:\/|$))[A-Za-z0-9._-]+)+$/;

/** The two kinds of partner profile: a person who runs things, or a place they run them in. */
export const HOST_KINDS = ['person', 'place'];

export function normaliseHostKind(input) {
  return input === 'place' ? 'place' : 'person';
}

// Iran's bounding box, generously rounded. This is not a precision check --
// it exists so a transposed pair (lat/lng swapped) or a stray 0/0 is refused
// instead of quietly putting a Mazandaran lodge in the Gulf of Guinea.
const IRAN_BOUNDS = { minLat: 24, maxLat: 40, minLng: 43, maxLng: 64 };

function coordinate(value, min, max, errors, field) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) { errors[field] = 'range'; return null; }
  return n;
}

const MAX_AMENITIES = 20;
const MAX_AMENITY_LEN = 40;

/** A short, flat list of strings. Anything else is a rejection, not a coercion. */
function validateAmenities(input, errors) {
  if (input === undefined || input === null) return null;
  if (!Array.isArray(input)) { errors.amenities = 'type'; return null; }
  if (input.length > MAX_AMENITIES) { errors.amenities = 'length'; return null; }
  const out = [];
  for (const raw of input) {
    const v = str(raw);
    if (!v) continue;
    if (v.length > MAX_AMENITY_LEN) { errors.amenities = 'item_length'; return null; }
    out.push(v);
  }
  return out.length ? out : null;
}


const MAX_TAGS = 10;
const MAX_TAG_LEN = 40;

/**
 * Short list of short strings (matching inputs). undefined = key absent (keep
 * what is stored); null = cleared. Anything that is not an array of strings
 * within the caps is a rejection, never a coercion.
 */
function validateTagList(input, errors, field) {
  if (input === undefined) return undefined;
  if (input === null) return null;
  if (!Array.isArray(input)) { errors[field] = 'type'; return undefined; }
  if (input.length > MAX_TAGS) { errors[field] = 'length'; return undefined; }
  const out = [];
  for (const raw of input) {
    if (typeof raw !== 'string') { errors[field] = 'type'; return undefined; }
    const v = raw.trim();
    if (!v) continue;
    if (v.length > MAX_TAG_LEN) { errors[field] = 'item_length'; return undefined; }
    if (!out.includes(v)) out.push(v);
  }
  return out.length ? out : null;
}

/** Whole guests, 1-500. undefined = absent, null = cleared/empty. */
function validateCapacity(input, errors, field = 'capacityGuests') {
  if (input === undefined) return undefined;
  if (input === null || input === '') return null;
  const n = Number(input);
  if (!Number.isInteger(n) || n < 1 || n > 500) { errors[field] = 'range'; return undefined; }
  return n;
}

/** Optional capped text. undefined = absent, null = empty. */
function optText(input, max, errors, field) {
  if (input === undefined) return undefined;
  if (input !== null && typeof input !== 'string') { errors[field] = 'type'; return undefined; }
  const v = str(input);
  if (v.length > max) { errors[field] = 'length'; return undefined; }
  return v || null;
}

/** Admin-managed host profile fields. Slug and kind are both fixed at create time and validated separately. */
export function validateHostProfile(input) {
  const errors = {};
  const kind = normaliseHostKind(input.kind);
  const displayName = str(input.displayName);
  const bio = str(input.bio);
  const expertise = str(input.expertise);
  const photoPath = str(input.photoPath);
  const region = str(input.region);
  const lodgingType = str(input.lodgingType);

  if (displayName.length < 1 || displayName.length > 80) errors.displayName = 'length';
  if (bio.length > 1500) errors.bio = 'length';
  if (expertise.length > 120) errors.expertise = 'length';
  if (region.length > 120) errors.region = 'length';
  if (lodgingType.length > 60) errors.lodgingType = 'length';

  const amenities = validateAmenities(input.amenities, errors);
  const latitude = coordinate(input.latitude, IRAN_BOUNDS.minLat, IRAN_BOUNDS.maxLat, errors, 'latitude');
  const longitude = coordinate(input.longitude, IRAN_BOUNDS.minLng, IRAN_BOUNDS.maxLng, errors, 'longitude');
  // Half a coordinate pair is not a location. Storing one alone would render
  // a map pinned to a made-up point on the other axis.
  if ((latitude == null) !== (longitude == null)) errors.coordinates = 'incomplete';

  // photoPath goes straight into an <img src> on a public page, so it must be
  // one of our own uploaded files. Without this an admin payload could point
  // every visitor's browser at a third-party URL, which is a tracking beacon
  // we would be serving ourselves. Only what /api/admin/upload produces is
  // accepted: an app-relative /images/... path with no traversal.
  if (photoPath && !HOST_PHOTO_PATH_RE.test(photoPath)) errors.photoPath = 'format';

  const instagram = normaliseInstagram(input.instagramHandle);
  if (instagram === false) errors.instagramHandle = 'format';

  let contactPhone = null;
  if (str(input.contactPhone)) {
    contactPhone = normalisePhone(input.contactPhone);
    if (!contactPhone) errors.contactPhone = 'format';
  }

  if (input.status !== undefined && !['active', 'hidden'].includes(input.status)) errors.status = 'value';

  const credentials = optText(input.credentials, 600, errors, 'credentials');
  const seekingPlaceTypes = validateTagList(input.seekingPlaceTypes, errors, 'seekingPlaceTypes');
  const capacityGuests = validateCapacity(input.capacityGuests, errors);
  const houseRules = optText(input.houseRules, 1000, errors, 'houseRules');
  const acceptsExperienceTypes = validateTagList(input.acceptsExperienceTypes, errors, 'acceptsExperienceTypes');

  if (Object.keys(errors).length) return { ok: false, errors };
  // Place fields are dropped for a person and person fields for a place, so
  // a kind switch in the payload can never smuggle a value into a column the
  // profile's own editor never shows.
  const isPlace = kind === 'place';
  return {
    ok: true,
    value: {
      kind,
      displayName,
      bio: bio || null,
      expertise: isPlace ? null : (expertise || null),
      photoPath: photoPath || null,
      instagramHandle: instagram || null,
      contactPhone,
      region: isPlace ? (region || null) : null,
      lodgingType: isPlace ? (lodgingType || null) : null,
      amenities: isPlace ? amenities : null,
      latitude: isPlace ? latitude : null,
      longitude: isPlace ? longitude : null,
      // undefined (key absent) means "leave the stored value alone".
      credentials: isPlace ? null : credentials,
      seekingPlaceTypes: isPlace ? null : seekingPlaceTypes,
      capacityGuests: isPlace ? capacityGuests : null,
      houseRules: isPlace ? houseRules : null,
      acceptsExperienceTypes: isPlace ? acceptsExperienceTypes : null,
      status: input.status === 'active' ? 'active' : 'hidden',
      verified: !!input.verified
    }
  };
}

/** One gallery image on a profile. The path must be one of our own uploads. */
export function validateHostMedia(input) {
  const errors = {};
  if (!Array.isArray(input)) return { ok: false, errors: { media: 'type' } };
  if (input.length > 24) return { ok: false, errors: { media: 'length' } };
  const value = [];
  input.forEach((raw, i) => {
    const photoPath = str(raw && raw.photoPath);
    const caption = str(raw && raw.caption);
    if (!HOST_PHOTO_PATH_RE.test(photoPath)) errors[`media.${i}.photoPath`] = 'format';
    if (caption.length > 120) errors[`media.${i}.caption`] = 'length';
    value.push({ photoPath, caption: caption || null });
  });
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value };
}

/**
 * A logged-in partner application.
 *
 * The applicant's identity (name, phone) is not in here at all -- it comes
 * from the session, so nothing typed into this form can claim to be someone
 * else. `name` is the PUBLIC profile name being proposed: a person's display
 * name, or the place's name.
 */
export function validateHostApplication(input) {
  const errors = {};
  const kind = normaliseHostKind(input.kind);
  const isPlace = kind === 'place';
  const fullName = str(input.fullName);
  const expertise = str(input.expertise);
  const region = str(input.region);
  const lodgingType = str(input.lodgingType);
  const description = str(input.description);

  if (fullName.length < 2 || fullName.length > 80) errors.fullName = 'length';
  if (description.length < 10 || description.length > 2000) errors.description = 'length';
  if (isPlace) {
    if (region.length < 2 || region.length > 120) errors.region = 'length';
    if (lodgingType.length > 60) errors.lodgingType = 'length';
  } else if (expertise.length > 120) {
    errors.expertise = 'length';
  }
  const capacityGuests = isPlace ? validateCapacity(input.capacityGuests, errors) : undefined;

  const instagram = normaliseInstagram(input.instagramHandle);
  if (instagram === false) errors.instagramHandle = 'format';

  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      kind,
      fullName,
      expertise: isPlace ? null : (expertise || null),
      region: isPlace ? region : null,
      lodgingType: isPlace ? (lodgingType || null) : null,
      capacityGuests: capacityGuests ?? null,
      description,
      instagramHandle: instagram || null
    }
  };
}

/** The signed-in user editing their own name. Phone and username are not touched here. */
export function validateUserName(input) {
  const errors = {};
  const firstName = str(input.firstName);
  const lastName = str(input.lastName);
  if (firstName.length < 1 || firstName.length > 60) errors.firstName = 'length';
  if (lastName.length < 1 || lastName.length > 60) errors.lastName = 'length';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { firstName, lastName } };
}


// --- partner panel -----------------------------------------------------------

/** Where an owner's pending uploads live: /images/host-<slug>/pending/<file>. */
export function pendingPathPrefix(slug) {
  return `/images/host-${slug}/pending/`;
}
const PENDING_FILE_RE = /^[A-Za-z0-9_.-]+$/;
export function isPendingPathFor(slug, path) {
  if (typeof path !== 'string') return false;
  const prefix = pendingPathPrefix(slug);
  return path.startsWith(prefix) && PENDING_FILE_RE.test(path.slice(prefix.length))
    && !/^\.\.?$/.test(path.slice(prefix.length));
}

/**
 * An owner's proposed edit to their own profile. Whitelist only: slug, kind,
 * status, verification, contact phone and ownership are not editable here at
 * all (unknown keys are ignored, never stored).
 *
 * Image paths are accepted only if they are already one of this profile's
 * stored images, or sit in this profile's own pending upload folder, so a
 * revision can never point a public page at an arbitrary or third-party path.
 *
 * ctx: { kind, slug, currentPaths: Set<string> }
 */
export function validateRevision(input, ctx) {
  const errors = {};
  const isPlace = ctx.kind === 'place';
  const okPath = (p) => HOST_PHOTO_PATH_RE.test(p)
    && (ctx.currentPaths.has(p) || isPendingPathFor(ctx.slug, p));

  const displayName = str(input.displayName);
  if (displayName.length < 1 || displayName.length > 80) errors.displayName = 'length';
  const bio = optText(input.bio, 1500, errors, 'bio');
  const photoPath = str(input.photoPath);
  if (photoPath && !okPath(photoPath)) errors.photoPath = 'format';
  const instagram = normaliseInstagram(input.instagramHandle);
  if (instagram === false) errors.instagramHandle = 'format';

  const value = { displayName, bio: bio ?? null, photoPath: photoPath || null, instagramHandle: instagram || null };

  if (isPlace) {
    value.region = optText(input.region, 120, errors, 'region') ?? null;
    value.lodgingType = optText(input.lodgingType, 60, errors, 'lodgingType') ?? null;
    value.amenities = validateAmenities(input.amenities, errors);
    value.capacityGuests = validateCapacity(input.capacityGuests, errors) ?? null;
    value.houseRules = optText(input.houseRules, 1000, errors, 'houseRules') ?? null;
    value.acceptsExperienceTypes = validateTagList(input.acceptsExperienceTypes, errors, 'acceptsExperienceTypes') ?? null;
    const latitude = coordinate(input.latitude, IRAN_BOUNDS.minLat, IRAN_BOUNDS.maxLat, errors, 'latitude');
    const longitude = coordinate(input.longitude, IRAN_BOUNDS.minLng, IRAN_BOUNDS.maxLng, errors, 'longitude');
    if ((latitude == null) !== (longitude == null)) errors.coordinates = 'incomplete';
    value.latitude = latitude;
    value.longitude = longitude;
    if (input.media !== undefined) {
      if (!Array.isArray(input.media)) errors.media = 'type';
      else if (input.media.length > 24) errors.media = 'length';
      else {
        value.media = [];
        input.media.forEach((raw, i) => {
          const p = str(raw && raw.photoPath);
          const caption = str(raw && raw.caption);
          if (!okPath(p)) errors[`media.${i}.photoPath`] = 'format';
          if (caption.length > 120) errors[`media.${i}.caption`] = 'length';
          value.media.push({ photoPath: p, caption: caption || null });
        });
      }
    }
  } else {
    value.expertise = optText(input.expertise, 120, errors, 'expertise') ?? null;
    value.credentials = optText(input.credentials, 600, errors, 'credentials') ?? null;
    value.seekingPlaceTypes = validateTagList(input.seekingPlaceTypes, errors, 'seekingPlaceTypes') ?? null;
  }

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value };
}

/** "Propose an experience to chaacme". The host is resolved server-side from an owned slug. */
export function validateProposal(input) {
  const errors = {};
  const title = str(input.title);
  const description = str(input.description);
  const preferredMonths = str(input.preferredMonths);
  const kind = ['person', 'place', 'none'].includes(input.wantedCounterpartKind) ? input.wantedCounterpartKind : 'none';
  if (input.wantedCounterpartKind !== undefined && kind !== input.wantedCounterpartKind) errors.wantedCounterpartKind = 'value';
  if (title.length < 3 || title.length > 120) errors.title = 'length';
  if (description.length < 10 || description.length > 2000) errors.description = 'length';
  if (preferredMonths.length > 60) errors.preferredMonths = 'length';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { title, description, preferredMonths: preferredMonths || null, wantedCounterpartKind: kind } };
}

// --- edition dates ---------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isRealIsoDate(v) {
  if (typeof v !== 'string' || !ISO_DATE.test(v)) return false;
  const d = new Date(v + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Validates the machine-readable part of an edition. `startsOn` / `endsOn` are
 * Gregorian YYYY-MM-DD; null clears one. Only keys present in `input` are
 * returned, so a PUT can change one field without touching the others.
 * `existing` ({ startsOn, endsOn }) lets a partial PUT be checked against the
 * stored other bound.
 */
export function validateEditionDates(input, existing = {}) {
  const errors = {};
  const value = {};
  for (const key of ['startsOn', 'endsOn']) {
    if (!(key in input)) continue;
    const v = input[key];
    if (v === null) value[key] = null;
    else if (isRealIsoDate(v)) value[key] = v;
    else errors[key] = 'format';
  }
  const startsOn = 'startsOn' in value ? value.startsOn : existing.startsOn ?? null;
  const endsOn = 'endsOn' in value ? value.endsOn : existing.endsOn ?? null;
  if (endsOn && !startsOn) errors.endsOn = 'needs_startsOn';
  else if (startsOn && endsOn && endsOn < startsOn) errors.endsOn = 'before_startsOn';
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value };
}
