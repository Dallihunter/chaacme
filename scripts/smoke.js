// Smoke test: boots the server on a temp DB with dev-mode OTP logging, then
// exercises the full catalog / auth / booking / review / admin surface.
import { spawn } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Smallest valid PNG (1x1 transparent pixel) — real magic bytes, so it
// exercises the upload endpoint's actual sniffing instead of a fake buffer.
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = mkdtempSync(join(tmpdir(), 'chaacme-platform-smoke-'));
const PORT = 3988;
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN_USERNAME = 'smoke-admin';
const ADMIN_PASSWORD = 'smoke-admin-password-123';
const SALT = 'smoke-ip-salt-0123456789abcdef';
const PEPPER = 'smoke-otp-pepper-0123456789abcdef';
const DB_PATH = join(dir, 'test.db');
// What a browser on the real site sends as Origin. FRONTEND_ORIGIN is set to it, exactly as in production,
// so the cross-site write guard runs in its allowlist mode.
const TEST_ORIGIN = 'http://127.0.0.1:9';

let pass = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};

// Seed the admin account into the same DB file the spawned server will open,
// before it starts — avoids two processes racing to write the account row.
process.env.CHAACME_PLATFORM_DB = DB_PATH;
process.env.IP_HASH_SALT = SALT;
process.env.OTP_PEPPER = PEPPER;
// Must match the spawned server's FRONTEND_STATIC_DIR below: the upload
// path-guard assertions import upload.js into this process and would
// otherwise resolve against a different images root, passing vacuously.
process.env.FRONTEND_STATIC_DIR = join(dir, 'images');
const { upsertAdminUser } = await import('../server/adminAuth.js');
upsertAdminUser(ADMIN_USERNAME, ADMIN_PASSWORD);

// The application endpoint is limited per IP as well as per user, and every
// request in this suite comes from 127.0.0.1 — so without this, the per-user
// cap could never be reached before the per-IP one fired. Clearing the shared
// fixed-window table between phases isolates the limit under test.
const { db: liveDb } = await import('../server/db.js');
const clearRateLimits = () => liveDb.prepare('DELETE FROM rate_limit').run();

// Fake ZarinPal: request.json always succeeds with a fresh authority;
// verify.json succeeds (code 100) unless a test has preset an override code
// for that authority via zpVerifyOverrides — lets the payment-failure and
// already-verified (101) paths be exercised without hitting the real network.
let zpCounter = 0;
const zpVerifyOverrides = new Map();
const zarinpalMock = createHttpServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body = {};
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { /* ignore */ }
  res.setHeader('content-type', 'application/json');
  if (req.url === '/pg/v4/payment/request.json') {
    const authority = `SMOKE-AUTHORITY-${++zpCounter}`;
    res.end(JSON.stringify({ data: { code: 100, authority, fee: 0 }, errors: [] }));
    return;
  }
  if (req.url === '/pg/v4/payment/verify.json') {
    const code = zpVerifyOverrides.has(body.authority) ? zpVerifyOverrides.get(body.authority) : 100;
    res.end(JSON.stringify({
      data: (code === 100 || code === 101) ? { code, ref_id: 900000 + zpCounter } : { code, message: 'mock failure' },
      errors: []
    }));
    return;
  }
  res.statusCode = 404;
  res.end('{}');
});
await new Promise((resolve) => zarinpalMock.listen(0, '127.0.0.1', resolve));
const ZARINPAL_MOCK_BASE = `http://127.0.0.1:${zarinpalMock.address().port}`;

let stdoutBuf = '';
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: root,
  env: {
    ...process.env, PORT: String(PORT),
    CHAACME_PLATFORM_DB: DB_PATH,
    FRONTEND_STATIC_DIR: join(dir, 'images'),
    IP_HASH_SALT: SALT, OTP_PEPPER: PEPPER,
    ZARINPAL_BASE_URL_OVERRIDE: ZARINPAL_MOCK_BASE,
    ZARINPAL_MERCHANT_ID: '11111111-1111-1111-1111-111111111111',
    ZARINPAL_CALLBACK_URL: `${BASE}/api/payments/zarinpal/callback`,
    FRONTEND_ORIGIN: TEST_ORIGIN // never actually called — smoke only inspects the redirect Location; also the write-guard allowlist
  },
  stdio: ['ignore', 'pipe', 'pipe']
});
server.stdout.on('data', (d) => { stdoutBuf += String(d); });
server.stderr.on('data', (d) => {
  const s = String(d);
  if (!s.includes('ExperimentalWarning') && !s.includes('trace-warnings')) process.stderr.write(s);
});

function lastOtpFor(phone) {
  const re = new RegExp(`DEV OTP for ${phone}: (\\d{5})`, 'g');
  let match, last;
  while ((match = re.exec(stdoutBuf))) last = match[1];
  return last;
}

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

const call = (method, path, body, headers = {}) =>
  fetch(BASE + path, {
    method, headers: { 'content-type': 'application/json', origin: TEST_ORIGIN, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
const get = (path, headers) => call('GET', path, undefined, headers);
const post = (path, body, headers) => call('POST', path, body, headers);
const put = (path, body, headers) => call('PUT', path, body, headers);

// FRONTEND_ORIGIN in this test env points nowhere real — the callback
// endpoint's redirects must not actually be followed, just inspected.
const getNoRedirect = (path) => fetch(BASE + path, { redirect: 'manual' });

function cookieFrom(res, name = 'chaacme_session') {
  const raw = res.headers.get('set-cookie') || '';
  const m = new RegExp(`${name}=([^;]+)`).exec(raw);
  return m ? `${name}=${m[1]}` : null;
}

try {
  if (!(await waitUp())) throw new Error('server did not start');

  console.log('\nhealth');
  const health = await get('/api/health');
  check('health returns 200', health.status === 200);
  check('health body is {status:"ok"}', JSON.stringify(await health.json()) === JSON.stringify({ status: 'ok' }));

  console.log('\nadmin: login');
  const badLogin = await post('/api/admin/login', { username: ADMIN_USERNAME, password: 'wrong-password' });
  check('wrong admin password rejected', badLogin.status === 401);
  const unknownUserLogin = await post('/api/admin/login', { username: 'nobody', password: ADMIN_PASSWORD });
  check('unknown admin username rejected', unknownUserLogin.status === 401);

  const adminLoginRes = await post('/api/admin/login', { username: ADMIN_USERNAME, password: ADMIN_PASSWORD });
  check('correct admin credentials accepted', adminLoginRes.status === 200);
  const adminCookie = cookieFrom(adminLoginRes, 'chaacme_admin_session');
  check('admin login sets a session cookie', !!adminCookie);
  const admin = { cookie: adminCookie, origin: TEST_ORIGIN };

  console.log('\ncsrf: cookie flags');
  const rawAdminSet = adminLoginRes.headers.getSetCookie();
  const adminSet = rawAdminSet.find((c) => c.startsWith('chaacme_admin_session=') && !c.startsWith('chaacme_admin_session=;')) || '';
  check('admin cookie is HttpOnly', /;\s*HttpOnly/i.test(adminSet));
  check('admin cookie is Secure', /;\s*Secure/i.test(adminSet));
  check('admin cookie is SameSite=Strict', /;\s*SameSite=Strict/i.test(adminSet));
  check('admin cookie is limited to Path=/api/admin', /;\s*Path=\/api\/admin(;|$)/i.test(adminSet));
  check('admin cookie is never SameSite=None', !/SameSite=None/i.test(adminSet));
  check('admin login also deletes the legacy Path=/ admin cookie',
    rawAdminSet.some((c) => /^chaacme_admin_session=;/.test(c) && /Path=\/(;|$)/.test(c) && /Max-Age=0/.test(c)));
  const adminLogoutProbe = await post('/api/admin/logout', {});
  const logoutSet = adminLogoutProbe.headers.getSetCookie();
  check('admin logout clears the cookie at its Path and the legacy Path=/',
    logoutSet.some((c) => /Path=\/api\/admin/.test(c) && /Max-Age=0/.test(c)) && logoutSet.some((c) => /Path=\/(;|$)/.test(c) && /Max-Age=0/.test(c)));

  const meNoSession = await get('/api/admin/me');
  check('GET /api/admin/me without a session is 401', meNoSession.status === 401);
  const meAdmin = await (await get('/api/admin/me', admin)).json();
  check('GET /api/admin/me returns the logged-in admin', meAdmin.admin?.username === ADMIN_USERNAME);

  console.log('\nconfig guard');
  // util.js imports db.js, whose top-level code opens a DatabaseSync at
  // import time — point that at a throwaway file so this dynamic import
  // (running in this process, not the spawned server) never touches data/.
  process.env.CHAACME_PLATFORM_DB = join(dir, 'unit.db');
  process.env.IP_HASH_SALT = SALT;
  process.env.OTP_PEPPER = PEPPER;
  const { assertRuntimeConfig } = await import('../server/util.js');
  check('missing IP_HASH_SALT and OTP_PEPPER refuses to start',
    assertRuntimeConfig({}).problems.length >= 2);
  check('production without SMS_WEBHOOK_URL is a hard failure',
    assertRuntimeConfig({ NODE_ENV: 'production', IP_HASH_SALT: 'a'.repeat(32), OTP_PEPPER: 'b'.repeat(32) })
      .problems.some((p) => p.includes('SMS_WEBHOOK_URL')));
  check('production with everything set passes',
    assertRuntimeConfig({
      NODE_ENV: 'production', IP_HASH_SALT: 'a'.repeat(32), OTP_PEPPER: 'b'.repeat(32),
      SMS_WEBHOOK_URL: 'https://example.com/sms', ZARINPAL_CALLBACK_URL: 'https://example.com/api/payments/zarinpal/callback',
      FRONTEND_ORIGIN: 'https://example.com'
    }).problems.length === 0);
  check('production without FRONTEND_ORIGIN (the write-guard allowlist) is a hard failure',
    assertRuntimeConfig({
      NODE_ENV: 'production', IP_HASH_SALT: 'a'.repeat(32), OTP_PEPPER: 'b'.repeat(32),
      SMS_WEBHOOK_URL: 'https://example.com/sms', ZARINPAL_CALLBACK_URL: 'https://example.com/api/payments/zarinpal/callback'
    }).problems.some((p) => p.includes('FRONTEND_ORIGIN')));
  check('outside production an unset FRONTEND_ORIGIN is only a warning',
    (() => { const r = assertRuntimeConfig({ IP_HASH_SALT: 'a'.repeat(32), OTP_PEPPER: 'b'.repeat(32) });
      return r.problems.length === 0 && r.warnings.some((w) => w.includes('FRONTEND_ORIGIN')); })());
  const prodOk = { NODE_ENV: 'production', IP_HASH_SALT: 'a'.repeat(32), OTP_PEPPER: 'b'.repeat(32), SMS_WEBHOOK_URL: 'https://example.com/sms',
    ZARINPAL_CALLBACK_URL: 'https://example.com/cb', FRONTEND_ORIGIN: 'https://example.com' };
  check('production refuses the COOKIE_SECURE=false dev override', assertRuntimeConfig({ ...prodOk, COOKIE_SECURE: 'false' }).problems.some((p) => p.includes('COOKIE_SECURE')));
  check('production refuses a COOKIE_SAMESITE=none dev override', assertRuntimeConfig({ ...prodOk, COOKIE_SAMESITE: 'none' }).problems.some((p) => p.includes('COOKIE_SAMESITE')));
  check('outside production a cookie override is a loud warning, not a failure',
    (() => { const r = assertRuntimeConfig({ IP_HASH_SALT: 'a'.repeat(32), OTP_PEPPER: 'b'.repeat(32), FRONTEND_ORIGIN: 'http://localhost:8080', COOKIE_SECURE: 'false' });
      return r.problems.length === 0 && r.warnings.some((w) => w.includes('COOKIE_SECURE')); })());
  const { cookiePolicy } = await import('../server/util.js');
  check('cookie policy defaults are the secure ones and ignore NODE_ENV and FRONTEND_ORIGIN',
    ['production', 'development', ''].every((n) => {
      const p = cookiePolicy({ NODE_ENV: n, FRONTEND_ORIGIN: 'https://chaacme.example' });
      return p.secure === true && p.userSameSite === 'lax' && p.overridden === false;
    }));
  check('dev mode without SMS_WEBHOOK_URL is only a warning',
    assertRuntimeConfig({ IP_HASH_SALT: 'a'.repeat(32), OTP_PEPPER: 'b'.repeat(32) }).problems.length === 0);

  const baseZarinpalEnv = { IP_HASH_SALT: 'a'.repeat(32), OTP_PEPPER: 'b'.repeat(32), SMS_WEBHOOK_URL: 'https://example.com/sms' };
  check('sandbox with no ZARINPAL_MERCHANT_ID is only a warning, not a hard failure',
    assertRuntimeConfig(baseZarinpalEnv).problems.length === 0);
  check('ZARINPAL_SANDBOX=false without a real merchant id is a hard failure',
    assertRuntimeConfig({ ...baseZarinpalEnv, NODE_ENV: 'production', ZARINPAL_SANDBOX: 'false', ZARINPAL_CALLBACK_URL: 'https://x.test/cb' })
      .problems.some((p) => p.includes('ZARINPAL_MERCHANT_ID')));
  check('ZARINPAL_SANDBOX=false with a real-looking merchant id passes',
    assertRuntimeConfig({
      ...baseZarinpalEnv, NODE_ENV: 'production', ZARINPAL_SANDBOX: 'false',
      ZARINPAL_MERCHANT_ID: '11111111-1111-1111-1111-111111111111', ZARINPAL_CALLBACK_URL: 'https://x.test/cb',
      FRONTEND_ORIGIN: 'https://x.test'
    }).problems.length === 0);
  check('production without ZARINPAL_CALLBACK_URL is a hard failure',
    assertRuntimeConfig({ ...baseZarinpalEnv, NODE_ENV: 'production' }).problems.some((p) => p.includes('ZARINPAL_CALLBACK_URL')));

  console.log('\ncatalog');
  const toursRes = await get('/api/tours');
  const toursBody = await toursRes.json();
  check('GET /api/tours is 200', toursRes.status === 200);
  check('all 6 seeded tours are listed', toursBody.tours.length === 6);
  check('animal-flow is featured', toursBody.tours.find((t) => t.id === 'animal-flow')?.featured === true);
  check('animal-flow is active (alias of featured)', toursBody.tours.find((t) => t.id === 'animal-flow')?.active === true);
  check('desert-parthian is not active (featured is false)', toursBody.tours.find((t) => t.id === 'desert-parthian')?.active === false);
  check('next-experience is coming soon', toursBody.tours.find((t) => t.id === 'next-experience')?.comingSoon === true);
  check('desert-parthian has a next-date availability label',
    typeof toursBody.tours.find((t) => t.id === 'desert-parthian')?.availability === 'string');
  const desertCard = toursBody.tours.find((t) => t.id === 'desert-parthian');
  check('desert-parthian card date is the seeded day/month', desertCard.date?.day === '۱۲' && desertCard.date?.month === 'مهر');
  check('desert-parthian card seats mirrors availability', desertCard.seats === desertCard.availability);
  check('desert-parthian priceLine is a Farsi-formatted string', desertCard.priceLine === '۲۳٬۰۰۰٬۰۰۰ تومان');
  check('next-experience (no price) has a null priceLine', toursBody.tours.find((t) => t.id === 'next-experience')?.priceLine === null);
  check('guchin-village has real dates but no curated card date', toursBody.tours.find((t) => t.id === 'guchin-village')?.date === null);

  const detailRes = await get('/api/tours/desert-parthian');
  const detail = (await detailRes.json()).tour;
  check('GET tour detail is 200', detailRes.status === 200);
  check('gallery has 5 photos', detail.gallery.length === 5);
  check('galleryPhotos is empty (no images uploaded yet)', Array.isArray(detail.galleryPhotos) && detail.galleryPhotos.length === 0);
  check('highlights has 5 entries', detail.highlights.length === 5);
  check('itinerary has 3 steps', detail.itinerary.length === 3);
  check('itinerary steps carry a photoPath key (null until an image is uploaded)', 'photoPath' in detail.itinerary[0]);
  check('reviewCategories has 4 entries', detail.reviewCategories.length === 4);
  // Reviews are never seeded (see seed() in db.js): a fresh catalog starts
  // with an honest empty review state rather than invented social proof.
  check('a freshly seeded tour has no reviews', detail.reviews.length === 0);
  check('reviewSummary reports an honest empty state',
    detail.reviewSummary.count === 0 && detail.reviewSummary.average === null);
  check('bookingDates has 3 dates', detail.bookingDates.length === 3);
  const fullDate = detail.bookingDates.find((d) => d.label === '۱۰ آبان');
  check('a fully-booked date is disabled with 0 available', fullDate.disabled === true && fullDate.available === 0);
  const openDate = detail.bookingDates.find((d) => d.label === '۲۶ مهر');
  check('an open date is not disabled and reports remaining seats', openDate.disabled === false && openDate.available === 14);

  const missing = await get('/api/tours/does-not-exist');
  check('unknown tour 404s', missing.status === 404);

  const reviewNoAuth = await post('/api/tours/desert-parthian/reviews', { rating: 5, body: 'test' });
  check('review submission requires auth', reviewNoAuth.status === 401);

  // OTP auth is switched off at the route level (OTP_AUTH_DISABLED in
  // server/api.js, 2026-09-23), so signup/login here exercise the
  // password flow that actually serves users today. The OTP assertions
  // this replaced tested three routes that now answer 410 by design.
  console.log('\nauth: disabled OTP routes');
  const phone = '09123456789';
  for (const route of ['/api/auth/otp/request', '/api/auth/otp/verify', '/api/auth/profile']) {
    const res = await post(route, { phone });
    check(`${route} is gone while OTP is disabled (410)`, res.status === 410);
  }

  console.log('\nauth: signup + login (password)');
  const PASSWORD = 'smoke-user-password-123';
  const signupRes = await post('/api/auth/signup', {
    phone, password: PASSWORD, firstName: 'سارا', lastName: 'کریمی', username: 'sara_k'
  });
  const signupBody = await signupRes.json();
  check('signup creates the account', signupRes.status === 201 && signupBody.user.username === 'sara_k');
  const cookie = cookieFrom(signupRes);
  check('signup sets a session cookie', !!cookie);

  const dupSignup = await post('/api/auth/signup', {
    phone, password: PASSWORD, firstName: 'x', lastName: 'y', username: 'someone_else'
  });
  check('signing up twice with the same phone is rejected', dupSignup.status === 409);

  const meRes = await get('/api/auth/me', { cookie });
  const meBody = await meRes.json();
  check('GET /api/auth/me returns the logged-in user', meRes.status === 200 && meBody.user.phone === phone);
  const meNoAuth = await get('/api/auth/me');
  check('GET /api/auth/me without a session is 401', meNoAuth.status === 401);

  console.log('\nauth: returning user');
  const badUserLogin = await post('/api/auth/login', { phone, password: 'wrong-password' });
  check('login with the wrong password is rejected', badUserLogin.status === 401);
  const goodLogin = await post('/api/auth/login', { phone, password: PASSWORD });
  check('login with the right password succeeds', goodLogin.status === 200);
  check('login sets a session cookie', !!cookieFrom(goodLogin));

  console.log('\ncsrf: user cookie flags and the cross-site write guard');
  const userSet = goodLogin.headers.getSetCookie().find((c) => c.startsWith('chaacme_session=')) || '';
  check('user cookie is HttpOnly + Secure + SameSite=Lax + Path=/',
    /;\s*HttpOnly/i.test(userSet) && /;\s*Secure/i.test(userSet) && /;\s*SameSite=Lax/i.test(userSet) && /;\s*Path=\/(;|$)/i.test(userSet));
  check('user cookie is not SameSite=None, whatever FRONTEND_ORIGIN says', !/SameSite=None/i.test(userSet));

  // Raw requests that say exactly which headers to send (no default Origin).
  const rawReq = (method, path, headers, body) => fetch(BASE + path, { method, headers, body });
  const FOREIGN = 'https://evil.example';
  const dateBefore = (await (await get(`/api/admin/tours/desert-parthian/dates`, admin)).json()).dates.find((d) => d.id === openDate.id);
  // THE earlier proof: admin cookie, text/plain body, foreign Origin -- must no longer be honoured.
  const csrfProof = await rawReq('PUT', `/api/admin/tour-dates/${openDate.id}`,
    { cookie: adminCookie, 'content-type': 'text/plain', origin: FOREIGN }, JSON.stringify({ capacity: 1 }));
  check('earlier CSRF proof (admin cookie + text/plain + foreign Origin) is refused with 403', csrfProof.status === 403);
  const dateAfter = (await (await get(`/api/admin/tours/desert-parthian/dates`, admin)).json()).dates.find((d) => d.id === openDate.id);
  check('...and nothing changed', dateAfter.capacity === dateBefore.capacity);
  const csrfJson = await rawReq('PUT', `/api/admin/tour-dates/${openDate.id}`,
    { cookie: adminCookie, 'content-type': 'application/json', origin: FOREIGN }, JSON.stringify({ capacity: 1 }));
  check('admin write with a foreign Origin and a proper JSON body is 403', csrfJson.status === 403 && (await csrfJson.json()).error === 'forbidden_origin');
  const userForeign = await rawReq('POST', '/api/bookings', { cookie, 'content-type': 'application/json', origin: FOREIGN },
    JSON.stringify({ tourId: 'desert-parthian', tourDateId: openDate.id, guests: 1 }));
  check('user write with a foreign Origin is 403', userForeign.status === 403);
  const nullOrigin = await rawReq('POST', '/api/bookings', { cookie, 'content-type': 'application/json', origin: 'null' }, '{}');
  check('Origin: null is 403', nullOrigin.status === 403);
  const prefixTrick = await rawReq('POST', '/api/bookings', { cookie, 'content-type': 'application/json', origin: TEST_ORIGIN + '.evil.example' }, '{}');
  check('an origin that merely starts with the allowed one is 403', prefixTrick.status === 403);
  const noOrigNoRef = await rawReq('PUT', `/api/admin/tour-dates/${openDate.id}`, { cookie: adminCookie, 'content-type': 'application/json' }, JSON.stringify({ capacity: 1 }));
  check('no Origin and no Referer is 403 (admin)', noOrigNoRef.status === 403);
  const noOrigNoRefUser = await rawReq('POST', '/api/bookings', { cookie, 'content-type': 'application/json' }, '{}');
  check('no Origin and no Referer is 403 (user)', noOrigNoRefUser.status === 403);
  const foreignReferer = await rawReq('PUT', `/api/admin/tour-dates/${openDate.id}`,
    { cookie: adminCookie, 'content-type': 'application/json', referer: `${FOREIGN}/attack.html` }, JSON.stringify({ capacity: 1 }));
  check('no Origin and a foreign Referer is 403', foreignReferer.status === 403);
  const goodReferer = await rawReq('PUT', `/api/admin/tour-dates/${openDate.id}`,
    { cookie: adminCookie, 'content-type': 'application/json', referer: `${TEST_ORIGIN}/admin/` }, JSON.stringify({ capacity: -5 }));
  check('no Origin but an allowed Referer passes the guard (then fails validation, 422)', goodReferer.status === 422);
  const sameOrigin = await rawReq('PUT', `/api/admin/tour-dates/${openDate.id}`,
    { cookie: adminCookie, 'content-type': 'application/json', origin: TEST_ORIGIN }, JSON.stringify({ capacity: -5 }));
  check('same-origin request passes the guard unchanged (422 from validation)', sameOrigin.status === 422);
  const charsetJson = await rawReq('PUT', `/api/admin/tour-dates/${openDate.id}`,
    { cookie: adminCookie, 'content-type': 'application/json; charset=utf-8', origin: TEST_ORIGIN }, JSON.stringify({ capacity: -5 }));
  check('application/json with a charset parameter is accepted', charsetJson.status === 422);
  const textPlain = await rawReq('PUT', `/api/admin/tour-dates/${openDate.id}`,
    { cookie: adminCookie, 'content-type': 'text/plain', origin: TEST_ORIGIN }, JSON.stringify({ capacity: 3 }));
  check('same-origin but text/plain body is 415', textPlain.status === 415 && (await textPlain.json()).error === 'unsupported_media_type');
  const formPost = await rawReq('POST', '/api/auth/login', { 'content-type': 'application/x-www-form-urlencoded', origin: TEST_ORIGIN }, 'phone=1&password=2');
  check('same-origin form-urlencoded body is 415', formPost.status === 415);
  const noType = await rawReq('POST', '/api/auth/login', { origin: TEST_ORIGIN }, JSON.stringify({ phone, password: PASSWORD }));
  check('a body with no Content-Type is 415', noType.status === 415);
  const multipartToJson = await rawReq('POST', '/api/auth/login', { 'content-type': 'multipart/form-data; boundary=x', origin: TEST_ORIGIN }, '--x--');
  check('multipart to a JSON route is 415', multipartToJson.status === 415);
  const jsonToUpload = await rawReq('POST', '/api/admin/upload', { cookie: adminCookie, 'content-type': 'application/json', origin: TEST_ORIGIN }, '{}');
  check('JSON to an upload route is 415', jsonToUpload.status === 415);
  const uploadForeign = await rawReq('POST', '/api/admin/upload', { cookie: adminCookie, 'content-type': 'multipart/form-data; boundary=x', origin: FOREIGN }, '--x--');
  check('uploads are covered by the Origin check too (foreign Origin is 403)', uploadForeign.status === 403);
  const bodyless = await rawReq('POST', '/api/auth/logout', { origin: TEST_ORIGIN });
  check('a bodyless POST with no Content-Type from the same origin works', bodyless.status === 200);
  const foreignGet = await rawReq('GET', '/api/tours', { origin: FOREIGN });
  check('GET is not affected (public catalog with a foreign Origin is 200)', foreignGet.status === 200);
  const preflight = await rawReq('OPTIONS', '/api/bookings', { origin: FOREIGN, 'access-control-request-method': 'POST' });
  check('OPTIONS preflight is not affected and grants a foreign origin nothing',
    preflight.status === 204 && !preflight.headers.get('access-control-allow-origin'));

  console.log('\nbookings');
  const noAuthBooking = await post('/api/bookings', { tourId: 'desert-parthian', tourDateId: openDate.id, guests: 1 });
  check('booking requires auth', noAuthBooking.status === 401);

  const bookRes = await post('/api/bookings', { tourId: 'desert-parthian', tourDateId: openDate.id, guests: 2 }, { cookie });
  const bookBody = await bookRes.json();
  check('booking created', bookRes.status === 201 && /^CHK-\d+$/.test(bookBody.booking.ref));
  check('booking total is price * guests', bookBody.booking.total === detail.price * 2);
  check('a freshly created booking does not reserve seats yet', (await (await get('/api/tours/desert-parthian')).json())
    .tour.bookingDates.find((d) => d.label === '۲۶ مهر').available === openDate.available);

  const overbook = await post('/api/bookings', { tourId: 'desert-parthian', tourDateId: fullDate.id, guests: 1 }, { cookie });
  check('booking a full date is rejected 409', overbook.status === 409 && (await overbook.json()).error === 'not_enough_seats');

  const bazm = (await (await get('/api/tours/bazm-vol1')).json()).tour;
  const bazmDate = bazm.bookingDates.find((d) => d.label === '۲۶ مهر');
  check('bazm-vol1 26 mehr has exactly 7 seats left', bazmDate.available === 7);

  console.log('\npayments: ZarinPal');
  const allBookingsSoFar = await (await get('/api/bookings/me', { cookie })).json();
  check('GET /api/bookings/me lists the pending booking', allBookingsSoFar.bookings.length === 1);

  const paymentReqNoAuth = await post('/api/payments/zarinpal/request', { bookingId: bookBody.booking.id ?? 1 });
  check('payment request requires auth', paymentReqNoAuth.status === 401);

  // admin bookings list exposes the numeric id the payment endpoints need
  const idFor = async (ref) => (await (await get('/api/admin/bookings', admin)).json()).bookings.find((b) => b.ref === ref).id;
  const firstBookingIdForPay = await idFor(bookBody.booking.ref);

  const otherUserPhone = '09120000111';
  const otherCookie = cookieFrom(await post('/api/auth/signup', {
    phone: otherUserPhone, password: 'other-user-password-123',
    firstName: 'ب', lastName: 'ب', username: 'other_user'
  }));
  const wrongOwnerReq = await post('/api/payments/zarinpal/request', { bookingId: firstBookingIdForPay }, { cookie: otherCookie });
  check('payment request 404s for a booking that belongs to someone else', wrongOwnerReq.status === 404);

  const payReq = await post('/api/payments/zarinpal/request', { bookingId: firstBookingIdForPay }, { cookie });
  const payReqBody = await payReq.json();
  check('payment request succeeds and returns a StartPay redirect', payReq.status === 200 && /SMOKE-AUTHORITY-\d+/.test(payReqBody.redirectUrl));
  const authority1 = /SMOKE-AUTHORITY-\d+/.exec(payReqBody.redirectUrl)[0];

  const rePayWhilePending = await post('/api/payments/zarinpal/request', { bookingId: firstBookingIdForPay }, { cookie });
  const rePayWhilePendingBody = await rePayWhilePending.json();
  check('a second payment request while still pending is allowed (retry)', rePayWhilePending.status === 200);
  // The retry above overwrote the booking's stored zarinpal_authority with a
  // fresh one — authority1 is now stale and no longer resolves to a booking.
  const authority2Retry = /SMOKE-AUTHORITY-\d+/.exec(rePayWhilePendingBody.redirectUrl)[0];

  const staleAuthorityCallback = await getNoRedirect(`/api/payments/zarinpal/callback?Authority=${authority1}&Status=OK`);
  check('a superseded (retried) authority no longer resolves to a booking',
    staleAuthorityCallback.status === 302 && /status=error/.test(staleAuthorityCallback.headers.get('location')));

  const cancelledCallback = await getNoRedirect(`/api/payments/zarinpal/callback?Authority=${authority2Retry}&Status=NOK`);
  check('Status!=OK marks the booking failed and redirects to the failed page',
    cancelledCallback.status === 302 && /status=failed/.test(cancelledCallback.headers.get('location')));

  const payAfterFail = await post('/api/payments/zarinpal/request', { bookingId: firstBookingIdForPay }, { cookie });
  check('a failed booking can no longer be paid for', payAfterFail.status === 400 && (await payAfterFail.json()).paymentStatus === 'failed');

  console.log('\npayments: successful confirmation reserves the seat exactly once');
  const secondBookRes = await post('/api/bookings', { tourId: 'desert-parthian', tourDateId: openDate.id, guests: 2 }, { cookie });
  const secondBookBody = await secondBookRes.json();
  const secondBookingId = await idFor(secondBookBody.booking.ref);
  const payReq2 = await (await post('/api/payments/zarinpal/request', { bookingId: secondBookingId }, { cookie })).json();
  const authority2 = /SMOKE-AUTHORITY-\d+/.exec(payReq2.redirectUrl)[0];

  const availableBefore = (await (await get('/api/tours/desert-parthian')).json()).tour.bookingDates.find((d) => d.label === '۲۶ مهر').available;
  const successCallback = await getNoRedirect(`/api/payments/zarinpal/callback?Authority=${authority2}&Status=OK`);
  check('successful verification redirects to the success page', successCallback.status === 302
    && /status=success/.test(successCallback.headers.get('location')));
  const availableAfter = (await (await get('/api/tours/desert-parthian')).json()).tour.bookingDates.find((d) => d.label === '۲۶ مهر').available;
  check('the seat is reserved only now, at payment confirmation', availableAfter === availableBefore - 2);

  const repeatCallback = await getNoRedirect(`/api/payments/zarinpal/callback?Authority=${authority2}&Status=OK`);
  check('hitting the same callback again is idempotent and does not double-decrement',
    repeatCallback.status === 302 && /status=success/.test(repeatCallback.headers.get('location')));
  const availableAfterRepeat = (await (await get('/api/tours/desert-parthian')).json()).tour.bookingDates.find((d) => d.label === '۲۶ مهر').available;
  check('capacity did not move on the repeated callback', availableAfterRepeat === availableAfter);

  console.log('\npayments: capacity runs out between request and verification -> paid_no_capacity');
  const exact = await post('/api/bookings', { tourId: 'bazm-vol1', tourDateId: bazmDate.id, guests: 7 }, { cookie });
  check('booking exactly the remaining seats succeeds (no capacity check yet)', exact.status === 201);
  const raceBooking = await post('/api/bookings', { tourId: 'bazm-vol1', tourDateId: bazmDate.id, guests: 7 }, { cookie: otherCookie });
  check('a second booking for the same (still nominally open) seats also succeeds — capacity is not held pre-payment',
    raceBooking.status === 201);

  const exactId = await idFor((await exact.json()).booking.ref);
  const exactPay = await (await post('/api/payments/zarinpal/request', { bookingId: exactId }, { cookie })).json();
  const exactAuthority = /SMOKE-AUTHORITY-\d+/.exec(exactPay.redirectUrl)[0];
  const exactConfirm = await getNoRedirect(`/api/payments/zarinpal/callback?Authority=${exactAuthority}&Status=OK`);
  check('the first of the two racing bookings to pay gets the seat', /status=success/.test(exactConfirm.headers.get('location')));

  const raceBody = await raceBooking.json();
  const raceId = await idFor(raceBody.booking.ref);
  const racePay = await (await post('/api/payments/zarinpal/request', { bookingId: raceId }, { cookie: otherCookie })).json();
  const raceAuthority = /SMOKE-AUTHORITY-\d+/.exec(racePay.redirectUrl)[0];
  const raceConfirm = await getNoRedirect(`/api/payments/zarinpal/callback?Authority=${raceAuthority}&Status=OK`);
  check('the second (too-late) payment lands on paid_no_capacity, never oversold',
    raceConfirm.status === 302 && /status=no_capacity/.test(raceConfirm.headers.get('location')));

  console.log('\npayments: ZarinPal verify failure and unknown authority');
  const failVerifyBooking = await post('/api/bookings', { tourId: 'desert-parthian', tourDateId: openDate.id, guests: 1 }, { cookie });
  const failVerifyId = await idFor((await failVerifyBooking.json()).booking.ref);
  const failVerifyPay = await (await post('/api/payments/zarinpal/request', { bookingId: failVerifyId }, { cookie })).json();
  const failVerifyAuthority = /SMOKE-AUTHORITY-\d+/.exec(failVerifyPay.redirectUrl)[0];
  zpVerifyOverrides.set(failVerifyAuthority, -9); // simulate ZarinPal rejecting verification
  const verifyFailCallback = await getNoRedirect(`/api/payments/zarinpal/callback?Authority=${failVerifyAuthority}&Status=OK`);
  check('a ZarinPal verify failure marks the booking failed, not paid',
    verifyFailCallback.status === 302 && /status=failed/.test(verifyFailCallback.headers.get('location')));

  const unknownAuthorityCallback = await getNoRedirect('/api/payments/zarinpal/callback?Authority=does-not-exist&Status=OK');
  check('an unknown authority redirects to a generic error page without leaking details',
    unknownAuthorityCallback.status === 302 && /status=error/.test(unknownAuthorityCallback.headers.get('location')));

  const mine = await get('/api/bookings/me', { cookie });
  const mineBody = await mine.json();
  check('GET /api/bookings/me lists every booking made for this user',
    mine.status === 200 && mineBody.bookings.length === 4);

  console.log('\nreviews + moderation');
  const reviewRes = await post('/api/tours/desert-parthian/reviews', { rating: 5, body: 'یک تجربه فوق‌العاده بود.' }, { cookie });
  const reviewBody = await reviewRes.json();
  check('review submitted as pending', reviewRes.status === 201 && reviewBody.review.status === 'pending');

  const stillNone = await (await get('/api/tours/desert-parthian')).json();
  check('a pending review does not affect the public summary yet', stillNone.tour.reviewSummary.count === 0);

  const pendingNoAuth = await get('/api/admin/reviews?status=pending');
  check('admin review queue requires token', pendingNoAuth.status === 401);
  const pending = await (await get('/api/admin/reviews?status=pending', admin)).json();
  check('pending review appears in the moderation queue', pending.reviews.some((r) => r.id === reviewBody.review.id));

  const approve = await put(`/api/admin/reviews/${reviewBody.review.id}`, { status: 'published' }, admin);
  check('admin can approve a review', approve.status === 200);
  const nowOne = await (await get('/api/tours/desert-parthian')).json();
  check('approved review is now counted in the public summary', nowOne.tour.reviewSummary.count === 1);

  console.log('\nadmin: catalog management');
  const wrongCookie = await get('/api/admin/tours', { cookie: 'chaacme_admin_session=not-a-real-session' });
  check('bogus admin session cookie rejected', wrongCookie.status === 401);

  const idTaken = await post('/api/admin/tours', { id: 'desert-parthian', name: 'Dupe' }, admin);
  check('creating a tour with an id that already exists is 409', idTaken.status === 409);
  const badId = await post('/api/admin/tours', { id: 'Not Valid ID!', name: 'Bad Id' }, admin);
  check('a non-slug tour id is rejected 422', badId.status === 422);

  const createTour = await post('/api/admin/tours', {
    id: 'test-tour', name: 'Test Tour', status: 'draft', photoPath: '/images/uploads/cover.jpg',
    dayLabel: '۵', monthLabel: 'دی',
    highlights: [{ name: 'H1', desc: 'first highlight' }, { name: 'H2', description: 'second highlight' }],
    itinerary: [{ time: 'صبح', title: 'Step 1', text: 'first step', photo: '/images/tour-test-tour/1.jpg' }],
    galleryImages: ['Cover', 'Second'], galleryPhotos: ['/images/tour-test-tour/1.jpg'],
    reviewCategories: [{ label: 'Food', score: 4.5 }]
  }, admin);
  check('admin can create a draft tour with nested content', createTour.status === 201);
  const hiddenWhileDraft = await get('/api/tours/test-tour');
  check('a draft tour is not publicly visible', hiddenWhileDraft.status === 404);

  const adminDetailNoAuth = await get('/api/admin/tours/test-tour');
  check('admin tour detail requires token', adminDetailNoAuth.status === 401);
  const adminDetail = await (await get('/api/admin/tours/test-tour', admin)).json();
  check('admin can fetch a draft tour\'s full detail', adminDetail.tour.status === 'draft');
  check('created highlights accept both desc and description aliases',
    adminDetail.tour.highlights.length === 2 && adminDetail.tour.highlights[0].description === 'first highlight'
    && adminDetail.tour.highlights[1].description === 'second highlight');
  check('created itinerary maps text->description and photo->photoPath',
    adminDetail.tour.itinerary[0].description === 'first step' && adminDetail.tour.itinerary[0].photoPath === '/images/tour-test-tour/1.jpg');
  check('created gallery has matching labels and photos', adminDetail.tour.gallery.length === 2 && adminDetail.tour.galleryPhotos.length === 1);
  check('created reviewCategories stored', adminDetail.tour.reviewCategories[0].label === 'Food');
  check('created tour carries photoPath/date', adminDetail.tour.photoPath === '/images/uploads/cover.jpg' && adminDetail.tour.date.day === '۵');

  const publishTour = await put('/api/admin/tours/test-tour', { status: 'published', price: 1000000, duration: 'یک‌روزه' }, admin);
  const publishBody = await publishTour.json();
  check('admin can publish a tour', publishTour.status === 200 && publishBody.tour.status === 'published');
  const visibleNow = await get('/api/tours/test-tour');
  check('the published tour is now publicly visible', visibleNow.status === 200);
  const stillHasChildren = await (await get('/api/tours/test-tour')).json();
  check('updating top-level fields alone leaves nested content untouched', stillHasChildren.tour.highlights.length === 2);

  const replaceHighlights = await put('/api/admin/tours/test-tour', { highlights: [{ name: 'Only', desc: 'replaced' }] }, admin);
  check('PUT with only highlights succeeds without touching top-level fields', replaceHighlights.status === 200);
  const afterReplace = await (await get('/api/tours/test-tour')).json();
  check('highlights were fully replaced, not appended', afterReplace.tour.highlights.length === 1 && afterReplace.tour.highlights[0].name === 'Only');
  check('a highlights-only PUT left price/status untouched', afterReplace.tour.price === 1000000 && afterReplace.tour.status === 'published');

  const addDate = await post('/api/admin/tours/test-tour/dates', { label: 'تاریخ آزمایشی', capacity: 5 }, admin);
  const addDateBody = await addDate.json();
  check('admin can add a bookable date', addDate.status === 201 && addDateBody.date.capacity === 5);

  const growCapacity = await put(`/api/admin/tour-dates/${addDateBody.date.id}`, { capacity: 10 }, admin);
  check('admin can change a date\'s capacity', (await growCapacity.json()).date.capacity === 10);

  console.log('\nadmin: bookings + users');
  const allBookings = await (await get('/api/admin/bookings', admin)).json();
  check('admin sees every booking across both users', allBookings.bookings.length === 5);
  check('booking list carries payment fields', 'paymentStatus' in allBookings.bookings[0] && 'zarinpalRefId' in allBookings.bookings[0]);
  const firstBookingId = allBookings.bookings[0].id;

  const filterStatus = allBookings.bookings[0].paymentStatus;
  const filtered = await (await get(`/api/admin/bookings?payment_status=${filterStatus}`, admin)).json();
  check('payment_status filter narrows the list', filtered.bookings.length > 0 && filtered.bookings.length <= allBookings.bookings.length);
  check('every filtered row matches the requested payment_status', filtered.bookings.every((b) => b.paymentStatus === filterStatus));

  const limitedBookings = await (await get('/api/admin/bookings?limit=2', admin)).json();
  check('limit caps the number of rows returned', limitedBookings.bookings.length === 2);
  const confirm = await put(`/api/admin/bookings/${firstBookingId}`, { status: 'confirmed' }, admin);
  check('admin can confirm a booking', confirm.status === 200 && (await confirm.json()).booking.status === 'confirmed');

  const users = await (await get('/api/admin/users', admin)).json();
  check('admin sees the created user', users.users.some((u) => u.username === 'sara_k'));
  check('admin user list carries no otp/session secrets', !JSON.stringify(users).match(/code_hash|token_hash/));

  console.log('\nadmin: image upload');
  const uploadForm = new FormData();
  uploadForm.append('file', new Blob([PNG_1X1], { type: 'image/png' }), 'cover.png');
  uploadForm.append('tourId', 'animal-flow');

  const uploadNoAuth = await fetch(`${BASE}/api/admin/upload`, { method: 'POST', headers: { origin: TEST_ORIGIN }, body: uploadForm });
  check('upload requires an admin session', uploadNoAuth.status === 401);

  const uploadRes = await fetch(`${BASE}/api/admin/upload`, { method: 'POST', headers: admin, body: uploadForm });
  const uploadBody = await uploadRes.json();
  check('valid PNG upload is accepted', uploadRes.status === 201 && uploadBody.ok === true);
  check('upload path uses the tour-<id> subfolder for a known tourId', uploadBody.path?.startsWith('/images/tour-animal-flow/'));
  check('uploaded file was actually written to FRONTEND_STATIC_DIR',
    existsSync(join(dir, 'images', uploadBody.path.replace('/images/', ''))));

  const uploadNoTourForm = new FormData();
  uploadNoTourForm.append('file', new Blob([PNG_1X1], { type: 'image/png' }), 'loose.png');
  const uploadNoTour = await (await fetch(`${BASE}/api/admin/upload`, { method: 'POST', headers: admin, body: uploadNoTourForm })).json();
  check('upload without a tourId falls back to the shared uploads/ folder', uploadNoTour.path?.startsWith('/images/uploads/'));

  const fakeForm = new FormData();
  fakeForm.append('file', new Blob([Buffer.from('not actually an image')], { type: 'image/jpeg' }), 'fake.jpg');
  const fakeUpload = await fetch(`${BASE}/api/admin/upload`, { method: 'POST', headers: admin, body: fakeForm });
  check('a file with a spoofed content-type but no real image signature is rejected', fakeUpload.status === 422);

  const oversized = Buffer.alloc(6 * 1024 * 1024, 0);
  PNG_1X1.copy(oversized); // real PNG header, but padded past the 5MB cap
  const bigForm = new FormData();
  bigForm.append('file', new Blob([oversized], { type: 'image/png' }), 'big.png');
  const bigUpload = await fetch(`${BASE}/api/admin/upload`, { method: 'POST', headers: admin, body: bigForm });
  check('an oversized file is rejected (413)', bigUpload.status === 413);

  const noFileForm = new FormData();
  noFileForm.append('tourId', 'animal-flow');
  const noFileUpload = await fetch(`${BASE}/api/admin/upload`, { method: 'POST', headers: admin, body: noFileForm });
  check('a request with no file field is rejected', noFileUpload.status === 422);

  const notMultipart = await post('/api/admin/upload', { hello: 'world' }, admin);
  // Used to be 400 from the upload handler; the write guard now refuses a non-multipart
  // body to an upload route up front, with 415, before authentication or any parsing.
  check('a JSON body instead of multipart is rejected', notMultipart.status === 415);

  console.log('\nadmin: gallery management');
  const galleryPutForm = new FormData();
  galleryPutForm.append('file', new Blob([PNG_1X1], { type: 'image/png' }), 'gallery-1.png');
  galleryPutForm.append('tourId', 'test-tour');
  const galleryUpload1 = await (await fetch(`${BASE}/api/admin/upload`, { method: 'POST', headers: admin, body: galleryPutForm })).json();

  const galleryPutForm2 = new FormData();
  galleryPutForm2.append('file', new Blob([PNG_1X1], { type: 'image/png' }), 'gallery-2.png');
  galleryPutForm2.append('tourId', 'test-tour');
  const galleryUpload2 = await (await fetch(`${BASE}/api/admin/upload`, { method: 'POST', headers: admin, body: galleryPutForm2 })).json();

  const setGallery = await put('/api/admin/tours/test-tour', {
    galleryImages: ['First', 'Second'], galleryPhotos: [galleryUpload1.path, galleryUpload2.path]
  }, admin);
  check('gallery replaced via PUT with two real uploaded photos', setGallery.status === 200);
  const galleryDetail = await (await get('/api/admin/tours/test-tour', admin)).json();
  check('galleryMedia carries stable ids alongside label/photoPath', galleryDetail.tour.galleryMedia.length === 2
    && galleryDetail.tour.galleryMedia.every((m) => typeof m.id === 'number'));
  const [media1, media2] = galleryDetail.tour.galleryMedia;

  const reorderNoAuth = await put('/api/admin/tours/test-tour/gallery/reorder', { order: [media2.id, media1.id] });
  check('gallery reorder requires an admin session', reorderNoAuth.status === 401);

  const badReorder = await put('/api/admin/tours/test-tour/gallery/reorder', { order: [media1.id] }, admin);
  check('a reorder array that is not a full permutation is rejected 422', badReorder.status === 422);

  const reorder = await put('/api/admin/tours/test-tour/gallery/reorder', { order: [media2.id, media1.id] }, admin);
  const reorderBody = await reorder.json();
  check('gallery reorder accepted', reorder.status === 200);
  check('reordered gallery now lists media2 first', reorderBody.media[0].id === media2.id);

  const deleteMediaNoAuth = await call('DELETE', `/api/admin/tours/test-tour/gallery/${media1.id}`);
  check('gallery photo delete requires an admin session', deleteMediaNoAuth.status === 401);

  const deleteMissing = await call('DELETE', '/api/admin/tours/test-tour/gallery/999999', undefined, admin);
  check('deleting a nonexistent gallery photo is 404', deleteMissing.status === 404);

  const deleteMedia = await call('DELETE', `/api/admin/tours/test-tour/gallery/${media1.id}`, undefined, admin);
  check('gallery photo delete accepted', deleteMedia.status === 200);
  check('deleted photo file was unlinked from disk',
    !existsSync(join(dir, 'images', media1.photoPath.replace('/images/', ''))));
  const afterDelete = await (await get('/api/admin/tours/test-tour', admin)).json();
  check('gallery now has one photo left', afterDelete.tour.galleryMedia.length === 1
    && afterDelete.tour.galleryMedia[0].id === media2.id);

  console.log('\nadmin: delete tour');
  const bookedDeleteAttempt = await call('DELETE', '/api/admin/tours/desert-parthian', undefined, admin);
  check('deleting a tour with real bookings is rejected 409', bookedDeleteAttempt.status === 409
    && (await bookedDeleteAttempt.json()).error === 'has_bookings');

  const deleteMissingTour = await call('DELETE', '/api/admin/tours/does-not-exist', undefined, admin);
  check('deleting a nonexistent tour is 404', deleteMissingTour.status === 404);

  const deleteTour = await call('DELETE', '/api/admin/tours/test-tour', undefined, admin);
  check('admin can delete a tour with no bookings', deleteTour.status === 200);
  const goneNow = await get('/api/admin/tours/test-tour', admin);
  check('deleted tour no longer exists', goneNow.status === 404);

  // ---- hosts (organizers) -------------------------------------------------
  // Every row created below lives only in this run's temp DB (mkdtempSync at
  // the top, rmSync in the finally block), so the whole dataset — hosts,
  // applications, tour links, uploaded files — is destroyed wholesale when
  // the run ends. There is no hard-delete endpoint for hosts by design
  // (hiding replaces deletion in this phase), so wholesale teardown is what
  // keeps the suite repeatable rather than per-row cleanup calls.
  console.log('\nhosts: admin auth is required');
  for (const [name, res] of Object.entries({
    'GET /api/admin/hosts': await get('/api/admin/hosts'),
    'POST /api/admin/hosts': await post('/api/admin/hosts', { slug: 'x' }),
    'GET /api/admin/host-applications': await get('/api/admin/host-applications'),
    'POST approve': await post('/api/admin/host-applications/1/approve', { slug: 'x' }),
    'POST reject': await post('/api/admin/host-applications/1/reject', {}),
    'PUT tour hosts': await put('/api/admin/tours/animal-flow/hosts', { hosts: [] })
  })) {
    check(`${name} is 401 without an admin session`, res.status === 401);
  }

  console.log('\nhosts: applying requires an account');
  const appAnon = await post('/api/host-applications', {
    kind: 'person', fullName: 'Anonymous Applicant',
    description: 'A genuine description of what I would run, long enough to pass.'
  });
  check('an application without a session is rejected (401)', appAnon.status === 401);

  clearRateLimits();
  const appOk = await post('/api/host-applications', {
    kind: 'person', fullName: 'Smoke Applicant', instagramHandle: '@smoke.applicant',
    expertise: 'کوهنوردی', description: 'A genuine description of what I would run, long enough to pass.'
  }, { cookie });
  check('a valid person application is accepted (201)', appOk.status === 201);
  check('the response body reveals nothing beyond ok',
    JSON.stringify(await appOk.json()) === JSON.stringify({ ok: true }));

  // Nothing about the applicant is taken from the form: their phone is read
  // from the session's account, so a form field could never claim another's.
  const appNoPhone = await (await get('/api/admin/host-applications?status=pending', admin)).json();
  const storedApp = appNoPhone.applications.find((a) => a.fullName === 'Smoke Applicant');
  check('an application is linked to the account that submitted it', !!storedApp && storedApp.userId != null);
  check('the applicant phone comes from their account, not the form',
    storedApp.phone === phone && storedApp.applicant.phone === phone);
  check('the admin sees the applicant account name', storedApp.applicant.firstName === 'سارا');

  const appBad = await post('/api/host-applications', { kind: 'person', fullName: 'x', description: 'short' }, { cookie });
  check('an invalid application is rejected (422)', appBad.status === 422);
  const appBadBody = await appBad.json();
  check('validation names the bad fields', !!appBadBody.fields?.fullName && !!appBadBody.fields?.description);

  const appBadInsta = await post('/api/host-applications', {
    kind: 'person', fullName: 'Insta Tester',
    instagramHandle: 'https://evil.example.com/someone',
    description: 'A genuine description of what I would run, long enough to pass.'
  }, { cookie });
  check('an instagram handle that is really a foreign URL is rejected', appBadInsta.status === 422);

  // A place must say where it is; a person must not be asked to.
  const placeNoRegion = await post('/api/host-applications', {
    kind: 'place', fullName: 'Nowhere Lodge', lodgingType: 'اقامتگاه بوم‌گردی',
    description: 'A genuine description of the place, long enough to pass validation.'
  }, { cookie });
  check('a place application without a region is rejected (422)',
    placeNoRegion.status === 422 && (await placeNoRegion.json()).fields.region === 'length');

  clearRateLimits();
  const placeOk = await post('/api/host-applications', {
    kind: 'place', fullName: 'Smoke Lodge', region: 'سه‌هزار، تنکابن، مازندران',
    lodgingType: 'اقامتگاه بوم‌گردی', expertise: 'ignored for a place',
    description: 'A genuine description of the place, long enough to pass validation.'
  }, { cookie });
  check('a valid place application is accepted (201)', placeOk.status === 201);
  const placeList = await (await get('/api/admin/host-applications?status=pending', admin)).json();
  const placeApp = placeList.applications.find((a) => a.fullName === 'Smoke Lodge');
  check('a place application keeps its kind and region',
    placeApp.kind === 'place' && placeApp.region === 'سه‌هزار، تنکابن، مازندران');
  check('expertise is dropped for a place rather than stored unread', placeApp.expertise === null);

  const appHoney = await post('/api/host-applications', {
    kind: 'person', fullName: 'Bot Bot', website: 'http://spam.example',
    description: 'A genuine description of what I would run, long enough to pass.'
  }, { cookie });
  check('a honeypot hit still answers 201 so the bot learns nothing', appHoney.status === 201);
  const afterHoneypot = await (await get('/api/admin/host-applications?status=pending', admin)).json();
  check('the honeypot submission was not stored',
    !afterHoneypot.applications.some((a) => a.fullName === 'Bot Bot'));

  // Three pending applications is the cap. The fourth answers 201 like every
  // other outcome here and is simply not stored.
  const capPhone = '09121230001';
  const capCookie = cookieFrom(await post('/api/auth/signup', {
    phone: capPhone, password: 'cap-user-password-123',
    firstName: 'کَپ', lastName: 'تستر', username: 'cap_tester'
  }));
  for (let i = 0; i < 4; i++) {
    clearRateLimits();
    await post('/api/host-applications', {
      kind: 'person', fullName: `Cap Applicant ${i}`,
      description: 'A genuine description of what I would run, long enough to pass.'
    }, { cookie: capCookie });
  }
  const capList = await (await get('/api/admin/host-applications?status=pending', admin)).json();
  const capRows = capList.applications.filter((a) => a.fullName.startsWith('Cap Applicant'));
  check('a user cannot stack more than three pending applications', capRows.length === 3);

  clearRateLimits();
  let appLimited = false;
  for (let i = 0; i < 6; i++) {
    const r = await post('/api/host-applications', {
      kind: 'person', fullName: 'Rate Tester',
      description: 'A genuine description of what I would run, long enough to pass.'
    }, { cookie: otherCookie });
    if (r.status === 429) { appLimited = true; break; }
  }
  check('the application endpoint rate limits', appLimited);
  clearRateLimits();

  console.log('\nhosts: approve flow');
  const pendingApps = await (await get('/api/admin/host-applications?status=pending', admin)).json();
  const smokeApp = pendingApps.applications.find((a) => a.fullName === 'Smoke Applicant');
  check('the pending application is listed for the admin', !!smokeApp);
  check('the stored instagram handle is bare, with no @ or URL', smokeApp.instagramHandle === 'smoke.applicant');

  const approveBadSlug = await post(`/api/admin/host-applications/${smokeApp.id}/approve`, { slug: 'Not A Slug' }, admin);
  check('approving with a malformed slug is rejected (422)', approveBadSlug.status === 422);

  const approved = await post(`/api/admin/host-applications/${smokeApp.id}/approve`, { slug: 'smoke-host' }, admin);
  check('approving an application succeeds', approved.status === 200);
  const approvedHost = (await approved.json()).host;
  check('approval creates the host as hidden, not live', approvedHost.status === 'hidden');
  check('the new host is prefilled from the application', approvedHost.displayName === 'Smoke Applicant');
  check("the approved profile takes its contact phone from the applicant's account",
    approvedHost.contactPhone === phone);
  check('the approved profile is owned by the account that applied', approvedHost.userId === meBody.user.id);
  check('an approved person profile has kind=person', approvedHost.kind === 'person');
  check('a newly approved host is not verified', approvedHost.verified === false);

  const reApprove = await post(`/api/admin/host-applications/${smokeApp.id}/approve`, { slug: 'smoke-host-2' }, admin);
  check('the same application cannot be approved twice', reApprove.status === 404);

  console.log('\nhosts: public profile visibility');
  const hiddenProfile = await get('/api/hosts/smoke-host');
  check('a hidden host is not publicly reachable (404)', hiddenProfile.status === 404);

  const activated = await put(`/api/admin/hosts/${approvedHost.id}`, {
    displayName: 'Smoke Host', bio: 'A real bio written by an admin.', expertise: 'کوهنوردی',
    instagramHandle: 'smoke.applicant', contactPhone: phone, status: 'active', verified: true
  }, admin);
  check('the admin can complete the profile and activate it', activated.status === 200);
  const activeHost = (await activated.json()).host;
  check('toggling verified on stamps verified_at', !!activeHost.verifiedAt && activeHost.verified === true);

  const publicProfileRes = await get('/api/hosts/smoke-host');
  check('an active host is publicly reachable', publicProfileRes.status === 200);
  const publicProfile = (await publicProfileRes.json()).host;
  const publicKeys = Object.keys(publicProfile);
  check('the public profile never exposes contact_phone', !publicKeys.includes('contactPhone'));
  check('the public profile never exposes user_id', !publicKeys.includes('userId'));
  check('the public profile never exposes the internal row id', !publicKeys.includes('id'));
  check('the public profile never exposes the raw verified_at timestamp', !publicKeys.includes('verifiedAt'));
  check('the public profile carries verified as a boolean', publicProfile.verified === true);
  check('a host with no reviews reports an honest empty state',
    publicProfile.reviews.length === 0 && publicProfile.reviewSummary.count === 0
    && publicProfile.reviewSummary.average === null);

  const unknownHost = await get('/api/hosts/no-such-host');
  check('an unknown slug is 404', unknownHost.status === 404);

  console.log('\nhosts: tour linking');
  const linkBadHost = await put('/api/admin/tours/animal-flow/hosts', { hosts: [{ hostId: 99999, role: 'lead' }] }, admin);
  check('linking an unknown host is rejected (422)', linkBadHost.status === 422);

  const linkDup = await put('/api/admin/tours/animal-flow/hosts', {
    hosts: [{ hostId: approvedHost.id, role: 'lead' }, { hostId: approvedHost.id, role: 'co_host' }]
  }, admin);
  check('linking the same host twice is rejected (422)', linkDup.status === 422);

  const linked = await put('/api/admin/tours/animal-flow/hosts', {
    hosts: [{ hostId: approvedHost.id, role: 'lead', sortOrder: 0 }]
  }, admin);
  check('a host can be linked to a tour', linked.status === 200);

  // The admin panel reads a tour's organizers back before editing them.
  const adminTourHosts = await get('/api/admin/tours/animal-flow/hosts', admin);
  check('admin can read a tour\'s host list', adminTourHosts.status === 200);
  const atH = (await adminTourHosts.json()).hosts;
  check('the admin tour host list carries hostId, slug, role and status',
    atH.length === 1 && atH[0].hostId === approvedHost.id && atH[0].slug === 'smoke-host'
    && atH[0].role === 'lead' && typeof atH[0].status === 'string');
  check('admin tour host list 404s for an unknown tour',
    (await get('/api/admin/tours/no-such-tour/hosts', admin)).status === 404);
  check('admin tour host list requires auth',
    (await get('/api/admin/tours/animal-flow/hosts')).status === 401);

  const tourWithHost = await (await get('/api/tours/animal-flow')).json();
  check('the tour detail response includes its hosts', tourWithHost.tour.hosts.length === 1);
  check('the tour host entry carries slug, name and role',
    tourWithHost.tour.hosts[0].slug === 'smoke-host' && tourWithHost.tour.hosts[0].role === 'lead');
  check('a tour host entry never leaks contact_phone',
    !Object.keys(tourWithHost.tour.hosts[0]).includes('contactPhone'));

  const profileWithTour = (await (await get('/api/hosts/smoke-host')).json()).host;
  const profileTours = profileWithTour.tours.upcoming.concat(profileWithTour.tours.past);
  check('the host profile lists the tour it runs',
    profileTours.some((t) => t.id === 'animal-flow'));

  // The profile's tour entries are rendered by the same card the catalogue
  // uses, so they must speak the catalogue's key names. This was a silent
  // rename (title -> name) that no assertion covered: the suite passed either
  // way while the host page would have shown blank titles.
  const hostTourCard = profileTours.find((t) => t.id === 'animal-flow');
  const catalogueCard = (await (await get('/api/tours')).json()).tours.find((t) => t.id === 'animal-flow');
  for (const key of ['name', 'tags', 'duration', 'comingSoon']) {
    check(`a host profile tour card carries ${key}`, Object.hasOwn(hostTourCard, key));
  }
  check('a host profile tour card has no leftover title key', !Object.hasOwn(hostTourCard, 'title'));
  check('a host profile tour card names the tour the same way the catalogue does',
    hostTourCard.name === catalogueCard.name && typeof hostTourCard.name === 'string' && hostTourCard.name.length > 0);
  check('comingSoon is a boolean, not a status string',
    typeof hostTourCard.comingSoon === 'boolean');

  // Nothing anywhere in the profile payload — host, tour cards or reviews —
  // may carry a phone number or a user id. Checking the serialised response
  // catches a leak nested at any depth, not just on the keys we thought of.
  const profileJson = JSON.stringify(profileWithTour);
  for (const banned of ['contactPhone', 'contact_phone', 'userId', 'user_id', phone]) {
    check(`the host profile response never contains ${banned}`, !profileJson.includes(banned));
  }

  // photoPath lands in an <img src> on a public page, so only our own uploaded
  // paths are accepted — never an absolute or protocol-relative URL.
  for (const bad of ['https://evil.example/px.gif', '//evil.example/px.gif', '/images/../../etc/passwd', 'javascript:alert(1)']) {
    const res = await put(`/api/admin/hosts/${approvedHost.id}`, {
      displayName: 'Smoke Host', status: 'active', photoPath: bad
    }, admin);
    check(`host photoPath ${JSON.stringify(bad)} is rejected (422)`, res.status === 422);
  }
  const goodPhoto = await put(`/api/admin/hosts/${approvedHost.id}`, {
    displayName: 'Smoke Host', status: 'active', photoPath: '/images/host-smoke-host/photo.png'
  }, admin);
  check('a host photoPath under /images/ is accepted', goodPhoto.status === 200);

  const hiddenAgain = await put(`/api/admin/hosts/${approvedHost.id}`, {
    displayName: 'Smoke Host', status: 'hidden', verified: false
  }, admin);
  check('a host can be hidden again instead of deleted', hiddenAgain.status === 200);
  check('un-verifying clears verified_at', (await hiddenAgain.json()).host.verifiedAt === null);
  const tourAfterHide = await (await get('/api/tours/animal-flow')).json();
  check('hiding a host removes it from the public tour response', tourAfterHide.tour.hosts.length === 0);

  console.log('\nhosts: photo upload path safety');
  const hostUploadForm = new FormData();
  hostUploadForm.append('file', new Blob([PNG_1X1], { type: 'image/png' }), 'host.png');
  hostUploadForm.append('hostSlug', 'smoke-host');
  const hostUpload = await (await fetch(`${BASE}/api/admin/upload`, { method: 'POST', headers: admin, body: hostUploadForm })).json();
  check('a host photo lands in its own host-<slug>/ directory',
    hostUpload.path === `/images/host-smoke-host/${hostUpload.path?.split('/').pop()}`
    && hostUpload.path.startsWith('/images/host-smoke-host/'));

  for (const badSlug of ['../x', 'a/b', 'host-../', '..', 'UPPER', 'x'.repeat(41)]) {
    const badForm = new FormData();
    badForm.append('file', new Blob([PNG_1X1], { type: 'image/png' }), 'bad.png');
    badForm.append('hostSlug', badSlug);
    const badUpload = await fetch(`${BASE}/api/admin/upload`, { method: 'POST', headers: admin, body: badForm });
    check(`upload rejects hostSlug ${JSON.stringify(badSlug)} (422)`, badUpload.status === 422);
  }

  // Traversal-shaped paths must also be refused by the delete-side guard, so
  // a crafted photo_path can never unlink a file outside the images tree.
  const { deleteUploadedFile } = await import('../server/upload.js');
  const escapeTarget = join(dir, 'images', 'escape-target.png');
  for (const badPath of ['/images/host-../secret.png', '/images/host-smoke-host/../../escape-target.png',
    '/images/host-UPPER/x.png', '/etc/passwd']) {
    writeFileSync(escapeTarget, PNG_1X1);
    deleteUploadedFile(badPath);
    check(`delete guard refuses ${JSON.stringify(badPath)}`, existsSync(escapeTarget));
  }
  // Sanity check the guard is not simply refusing everything.
  const realDelete = join(dir, 'images', 'host-smoke-host', hostUpload.path.split('/').pop());
  check('the delete guard still deletes a legitimate host photo',
    existsSync(realDelete) && (deleteUploadedFile(hostUpload.path), !existsSync(realDelete)));
  rmSync(escapeTarget, { force: true });

  // ---- places, roles and the account-scoped endpoints ---------------------
  console.log('\nplaces: profile kind and coordinates');
  const EXACT_LAT = 36.8123456;
  const EXACT_LNG = 50.8987654;
  const placeCreate = await post('/api/admin/hosts', {
    slug: 'smoke-lodge', kind: 'place', displayName: 'اقامتگاه دود',
    region: 'سه‌هزار، تنکابن، مازندران', lodgingType: 'اقامتگاه بوم‌گردی',
    amenities: ['وای‌فای', 'صبحانه'], latitude: EXACT_LAT, longitude: EXACT_LNG,
    bio: 'A place description.', contactPhone: '09121119999', status: 'active'
  }, admin);
  check('an admin can create a place profile', placeCreate.status === 201);
  const placeHost = (await placeCreate.json()).host;
  check('the place keeps its exact coordinates internally',
    placeHost.latitude === EXACT_LAT && placeHost.longitude === EXACT_LNG);
  check('the place stores its amenities as a list', Array.isArray(placeHost.amenities) && placeHost.amenities.length === 2);

  for (const bad of [
    { latitude: 0, longitude: 0 },                    // null island
    { latitude: EXACT_LNG, longitude: EXACT_LAT },    // transposed pair
    { latitude: EXACT_LAT, longitude: null },         // half a pair
    { latitude: 51.5, longitude: -0.12 }              // London
  ]) {
    const res = await put(`/api/admin/hosts/${placeHost.id}`, {
      displayName: 'اقامتگاه دود', status: 'active', ...bad
    }, admin);
    check(`coordinates ${JSON.stringify(bad)} are rejected (422)`, res.status === 422);
  }
  const tooManyAmenities = await put(`/api/admin/hosts/${placeHost.id}`, {
    displayName: 'اقامتگاه دود', status: 'active',
    amenities: Array.from({ length: 21 }, (_, i) => 'a' + i)
  }, admin);
  check('more than 20 amenities is rejected (422)', tooManyAmenities.status === 422);
  const longAmenity = await put(`/api/admin/hosts/${placeHost.id}`, {
    displayName: 'اقامتگاه دود', status: 'active', amenities: ['x'.repeat(41)]
  }, admin);
  check('an over-long amenity is rejected (422)', longAmenity.status === 422);

  // kind is fixed at create time, exactly like the slug. This PUT resends the
  // full profile because the endpoint replaces every field it owns — sending a
  // partial payload here would blank the place fields, not preserve them.
  const kindFlip = await put(`/api/admin/hosts/${placeHost.id}`, {
    displayName: 'اقامتگاه دود', status: 'active', kind: 'person',
    region: 'سه‌هزار، تنکابن، مازندران', lodgingType: 'اقامتگاه بوم‌گردی',
    amenities: ['وای‌فای', 'صبحانه'], latitude: EXACT_LAT, longitude: EXACT_LNG,
    bio: 'A place description.', contactPhone: '09121119999'
  }, admin);
  check('a PUT cannot change a profile from place to person',
    kindFlip.status === 200 && (await kindFlip.json()).host.kind === 'place');

  const publicPlace = (await (await get('/api/hosts/smoke-lodge')).json()).host;
  check('the public place carries kind, region and lodging type',
    publicPlace.kind === 'place' && publicPlace.region === 'سه‌هزار، تنکابن، مازندران'
    && publicPlace.lodgingType === 'اقامتگاه بوم‌گردی');
  check('the public place reports an approximate location rounded to 2 decimals',
    publicPlace.approximateLocation.lat === 36.81 && publicPlace.approximateLocation.lng === 50.9);

  // Walks the whole payload, not just the top level: a coordinate nested in a
  // tour card or a review would be just as much of a leak.
  function coordLeaks(node, path = '$') {
    if (Array.isArray(node)) return node.flatMap((v, i) => coordLeaks(v, `${path}[${i}]`));
    if (node && typeof node === 'object') {
      return Object.entries(node).flatMap(([k, v]) => {
        if (typeof v === 'number' && /^(lat|lng|latitude|longitude)$/i.test(k)
          && Math.abs(v * 100 - Math.round(v * 100)) > 1e-9) return [`${path}.${k}=${v}`];
        return coordLeaks(v, `${path}.${k}`);
      });
    }
    return [];
  }
  const placeLeaks = coordLeaks(publicPlace);
  check('no coordinate anywhere in the public place has more than 2 decimals',
    placeLeaks.length === 0, placeLeaks.join(', '));
  const placeJson = JSON.stringify(publicPlace);
  for (const banned of [String(EXACT_LAT), String(EXACT_LNG), 'latitude', 'longitude', 'contactPhone', 'userId']) {
    check(`the public place response never contains ${banned}`, !placeJson.includes(banned));
  }
  console.log('\nplaces: gallery');
  const galleryBad = await put(`/api/admin/hosts/${placeHost.id}/media`, {
    media: [{ photoPath: '/images/host-smoke-lodge/../../etc/passwd' }]
  }, admin);
  check('a traversal-shaped gallery path is rejected (422)', galleryBad.status === 422);
  for (const bad of ['https://evil.example/x.png', '//evil.example/x.png', '/etc/passwd', 'images/x.png', '']) {
    const res = await put(`/api/admin/hosts/${placeHost.id}/media`, { media: [{ photoPath: bad }] }, admin);
    check(`gallery path ${JSON.stringify(bad)} is rejected (422)`, res.status === 422);
  }
  const galleryLongCaption = await put(`/api/admin/hosts/${placeHost.id}/media`, {
    media: [{ photoPath: '/images/host-smoke-lodge/a.png', caption: 'x'.repeat(121) }]
  }, admin);
  check('an over-long gallery caption is rejected (422)', galleryLongCaption.status === 422);

  const gallerySet = await put(`/api/admin/hosts/${placeHost.id}/media`, {
    media: [
      { photoPath: '/images/host-smoke-lodge/a.png', caption: 'حیاط' },
      { photoPath: '/images/host-smoke-lodge/b.png', caption: null }
    ]
  }, admin);
  check('a valid gallery is stored', gallerySet.status === 200);
  check('the gallery keeps the order it was sent in',
    (await gallerySet.json()).media.map((m) => m.photoPath).join(',')
      === '/images/host-smoke-lodge/a.png,/images/host-smoke-lodge/b.png');
  const placeWithGallery = (await (await get('/api/hosts/smoke-lodge')).json()).host;
  check('the public place exposes its gallery with captions',
    placeWithGallery.gallery.length === 2 && placeWithGallery.gallery[0].caption === 'حیاط');
  check('a gallery entry carries no internal row id', !('id' in placeWithGallery.gallery[0]));
  check('the gallery endpoint 404s for an unknown profile',
    (await put('/api/admin/hosts/999999/media', { media: [] }, admin)).status === 404);
  check('the gallery endpoint requires an admin session',
    (await put(`/api/admin/hosts/${placeHost.id}/media`, { media: [] })).status === 401);

  console.log('\ntour links: role and kind must agree');
  const personId = approvedHost.id;
  const placeAsCoHost = await put('/api/admin/tours/animal-flow/hosts', {
    hosts: [{ hostId: placeHost.id, role: 'co_host' }]
  }, admin);
  check('a place cannot be linked as a co-host (422)',
    placeAsCoHost.status === 422 && (await placeAsCoHost.json()).fields.role === 'place_must_be_venue');
  const personAsVenue = await put('/api/admin/tours/animal-flow/hosts', {
    hosts: [{ hostId: personId, role: 'venue' }]
  }, admin);
  check('a person cannot be linked as the venue (422)',
    personAsVenue.status === 422 && (await personAsVenue.json()).fields.role === 'person_cannot_be_venue');

  const secondPlace = (await (await post('/api/admin/hosts', {
    slug: 'smoke-lodge-2', kind: 'place', displayName: 'اقامتگاه دوم',
    region: 'گیلان', status: 'active'
  }, admin)).json()).host;
  const twoVenues = await put('/api/admin/tours/animal-flow/hosts', {
    hosts: [{ hostId: placeHost.id, role: 'venue' }, { hostId: secondPlace.id, role: 'venue' }]
  }, admin);
  check('a tour cannot have two venues (422)',
    twoVenues.status === 422 && (await twoVenues.json()).fields.role === 'multiple_venues');

  // Re-activate the person hidden by the earlier visibility test so the mixed
  // link below has someone to show.
  await put(`/api/admin/hosts/${personId}`, { displayName: 'Smoke Host', status: 'active' }, admin);

  const personPublic = (await (await get('/api/hosts/smoke-host')).json()).host;
  check('a person profile carries no place fields at all',
    personPublic.kind === 'person' && !('region' in personPublic)
    && !('approximateLocation' in personPublic) && !('amenities' in personPublic));
  const mixedLink = await put('/api/admin/tours/animal-flow/hosts', {
    hosts: [{ hostId: personId, role: 'lead', sortOrder: 0 }, { hostId: placeHost.id, role: 'venue', sortOrder: 1 }]
  }, admin);
  check('a tour can carry one venue and one person together', mixedLink.status === 200);

  const mixedTour = (await (await get('/api/tours/animal-flow')).json()).tour;
  check('the venue is listed before the people on the tour', mixedTour.hosts[0].role === 'venue');
  check('the tour venue entry is a place with a region',
    mixedTour.hosts[0].kind === 'place' && mixedTour.hosts[0].region === 'سه‌هزار، تنکابن، مازندران');
  check('the tour person entry is a person with no place fields',
    mixedTour.hosts[1].kind === 'person' && !('region' in mixedTour.hosts[1]));
  const mixedLeaks = coordLeaks(mixedTour);
  check('no coordinate in a tour detail response has more than 2 decimals',
    mixedLeaks.length === 0, mixedLeaks.join(', '));
  const catalogueLeaks = coordLeaks(await (await get('/api/tours')).json());
  check('no coordinate in the tour catalogue has more than 2 decimals',
    catalogueLeaks.length === 0, catalogueLeaks.join(', '));
  check('the place profile lists the tour held there',
    (await (await get('/api/hosts/smoke-lodge')).json()).host.tours.upcoming.some((t) => t.id === 'animal-flow'));

  console.log('\naccount: the session user sees only their own data');
  for (const route of ['/api/me/applications', '/api/me/profiles', '/api/me/reviews']) {
    check(`GET ${route} is 401 without a session`, (await get(route)).status === 401);
  }
  const myApps = (await (await get('/api/me/applications', { cookie })).json()).applications;
  check('my applications list what I submitted', myApps.some((a) => a.name === 'Smoke Applicant'));
  check('my applications say which kind each one was',
    myApps.some((a) => a.name === 'Smoke Lodge' && a.kind === 'place'));
  check('my applications carry no internal admin note',
    myApps.every((a) => !('adminNote' in a) && !('ipHash' in a)));

  const otherApps = (await (await get('/api/me/applications', { cookie: otherCookie })).json()).applications;
  check('another account cannot see my applications',
    !otherApps.some((a) => a.name === 'Smoke Applicant' || a.name === 'Smoke Lodge'));
  const capApps = (await (await get('/api/me/applications', { cookie: capCookie })).json()).applications;
  check('each account sees exactly its own applications',
    capApps.length === 3 && capApps.every((a) => a.name.startsWith('Cap Applicant')));

  const myProfiles = (await (await get('/api/me/profiles', { cookie })).json()).profiles;
  check('my profiles list the one created by approving my application',
    myProfiles.some((h) => h.slug === 'smoke-host'));
  check('my profiles carry no contact phone or owner id',
    myProfiles.every((h) => !('contactPhone' in h) && !('userId' in h)));
  const otherProfiles = (await (await get('/api/me/profiles', { cookie: otherCookie })).json()).profiles;
  check('another account cannot see my profiles', otherProfiles.length === 0);
  check('an admin-created profile with no owner belongs to nobody',
    !myProfiles.some((h) => h.slug === 'smoke-lodge') && !otherProfiles.some((h) => h.slug === 'smoke-lodge'));

  const myReviews = (await (await get('/api/me/reviews', { cookie })).json()).reviews;
  check('my reviews are scoped to my account and carry their status',
    Array.isArray(myReviews) && myReviews.every((r) => typeof r.status === 'string'));

  console.log('\naccount: editing my own name');
  check('PUT /api/auth/me needs a session', (await put('/api/auth/me', { firstName: 'a', lastName: 'b' })).status === 401);
  const badName = await put('/api/auth/me', { firstName: '', lastName: 'کریمی' }, { cookie });
  check('an empty first name is rejected (422)', badName.status === 422);
  const renamed = await put('/api/auth/me', { firstName: 'سارا', lastName: 'کریمی‌فر' }, { cookie });
  check('a user can rename themselves', renamed.status === 200 && (await renamed.json()).user.lastName === 'کریمی‌فر');
  const afterRename = await (await get('/api/auth/me', { cookie })).json();
  check('the rename is reflected on the session user', afterRename.user.lastName === 'کریمی‌فر');
  check('renaming cannot change the phone number', afterRename.user.phone === phone);

  console.log('\nrate limiting');
  // The OTP request route used to be the subject here; it is gated off at
  // 410 now (OTP_AUTH_DISABLED) and can never reach the limiter, so login
  // — which shares the same allow() helper — stands in for it.
  let limited = false;
  for (let i = 0; i < 14; i++) {
    const r = await post('/api/auth/login', { phone: '09370000001', password: 'whatever-wrong' });
    if (r.status === 429) { limited = true; break; }
  }
  check('login endpoint rate limits by phone', limited);

  const unknownRoute = await get('/api/nope');
  check('unknown api route 404s as json', unknownRoute.status === 404);

  console.log(`\n${pass} passed, ${fail} failed`);
} catch (err) {
  console.error('smoke error:', err.stack || err.message);
  fail++;
} finally {
  server.kill();
  rmSync(dir, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}
