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

export function parseCookies(req) {
  const header = req.headers?.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) out[name] = decodeURIComponent(value);
  }
  return out;
}

export function sessionCookie(token, { maxAgeSeconds, clear = false, name = 'chaacme_session' } = {}) {
  // A cross-origin frontend (FRONTEND_ORIGIN set — see index.js) calls this
  // API via fetch/XHR, not a top-level navigation, so SameSite=Lax would
  // simply never be sent back and every request would look logged-out.
  // SameSite=None is the only setting that works cross-site, and browsers
  // require Secure alongside it (works on http://localhost as an exception
  // in Chromium; anywhere else this needs real HTTPS).
  const crossOrigin = !!(process.env.FRONTEND_ORIGIN || '').trim();
  const parts = [
    `${name}=${clear ? '' : encodeURIComponent(token)}`, 'Path=/', 'HttpOnly',
    crossOrigin ? 'SameSite=None' : 'SameSite=Lax'
  ];
  if (crossOrigin || process.env.NODE_ENV === 'production') parts.push('Secure');
  parts.push(clear ? 'Max-Age=0' : `Max-Age=${maxAgeSeconds}`);
  return parts.join('; ');
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
