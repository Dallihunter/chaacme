import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'chaacme-'));
const PORT = 4300 + Math.floor(Math.random() * 400);
const SITE = 'https://chaacme.test';
Object.assign(process.env, {
  CHAACME_PLATFORM_DB: join(dir, 't.db'), IP_HASH_SALT: 'x'.repeat(24), OTP_PEPPER: 'y'.repeat(24),
  FRONTEND_STATIC_DIR: join(dir, 'images'), PORT: String(PORT), HOST: '127.0.0.1',
  FRONTEND_ORIGIN: SITE // production-like: allowlist mode
});

const util = await import('../server/util.js');
const { server } = await import('../server/index.js');
const db = await import('../server/db.js');
const adminAuth = await import('../server/adminAuth.js');
const auth = await import('../server/auth.js');
const base = `http://127.0.0.1:${PORT}`;

before(async () => { if (!server.listening) await new Promise((r) => server.once('listening', r)); });
after(() => server.close());

const req = (method, headers = {}) => ({ method, headers });
const env = (FRONTEND_ORIGIN) => ({ FRONTEND_ORIGIN });

// ---------------------------------------------------------------- allowlist
test('allowedOrigins: FRONTEND_ORIGIN plus its www / non-www twin, nothing else', () => {
  assert.equal(util.allowedOrigins({}), null);
  assert.equal(util.allowedOrigins({ FRONTEND_ORIGIN: '   ' }), null);
  assert.deepEqual([...util.allowedOrigins(env('https://chaacme.ir'))].sort(), ['https://chaacme.ir', 'https://www.chaacme.ir']);
  assert.deepEqual([...util.allowedOrigins(env('https://www.chaacme.ir/'))].sort(), ['https://chaacme.ir', 'https://www.chaacme.ir']);
  assert.deepEqual([...util.allowedOrigins(env('https://chaacme.ir:8443'))].sort(), ['https://chaacme.ir:8443', 'https://www.chaacme.ir:8443']);
  // no invented twins for an IP or a bare hostname
  assert.deepEqual([...util.allowedOrigins(env('http://127.0.0.1:3000'))], ['http://127.0.0.1:3000']);
  assert.deepEqual([...util.allowedOrigins(env('http://localhost:3000'))], ['http://localhost:3000']);
});

test('checkWriteOrigin (allowlist mode): every way of getting it wrong is refused', () => {
  const e = env('https://chaacme.ir');
  const ok = (headers) => util.checkWriteOrigin(req('POST', headers), e).ok;
  assert.equal(ok({ origin: 'https://chaacme.ir' }), true);
  assert.equal(ok({ origin: 'https://www.chaacme.ir' }), true, 'the www twin');
  for (const bad of ['https://evil.example', 'http://chaacme.ir', 'https://chaacme.ir:8443', 'https://chaacme.ir.evil.example',
    'https://evil.chaacme.ir', 'https://chaacme.irx', 'null', '', 'https://chaacme.ir/', 'chaacme.ir', 'https://CHAACME.IR.evil.example']) {
    assert.equal(ok({ origin: bad }), false, `Origin: ${JSON.stringify(bad)}`);
  }
  // Referer is consulted only when there is NO Origin header
  assert.equal(ok({ referer: 'https://chaacme.ir/admin/#/revisions' }), true);
  assert.equal(ok({ referer: 'https://www.chaacme.ir/partner' }), true);
  for (const bad of ['https://evil.example/https://chaacme.ir/', 'https://chaacme.ir.evil.example/', 'not a url', 'https://evil.example/?https://chaacme.ir']) {
    assert.equal(ok({ referer: bad }), false, `Referer: ${bad}`);
  }
  assert.equal(ok({}), false, 'neither header');
  assert.equal(ok({ origin: 'https://evil.example', referer: 'https://chaacme.ir/' }), false, 'a bad Origin is not rescued by a good Referer');
  assert.equal(ok({ origin: 'https://chaacme.ir', referer: 'https://evil.example/' }), true, 'Origin decides when present');
  assert.equal(util.checkWriteOrigin(req('POST', { origin: 'https://evil.example' }), e).reason, 'origin_not_allowed');
  assert.equal(util.checkWriteOrigin(req('POST', {}), e).reason, 'no_origin_or_referer');
});

test('checkWriteOrigin (FRONTEND_ORIGIN unset, local development): same host only', () => {
  const ok = (headers) => util.checkWriteOrigin(req('POST', headers), {}).ok;
  assert.equal(ok({ host: '127.0.0.1:3100', origin: 'http://127.0.0.1:3100' }), true);
  assert.equal(ok({ host: '127.0.0.1:3100', origin: 'http://127.0.0.1:3101' }), false);
  assert.equal(ok({ host: '127.0.0.1:3100', origin: 'http://evil.example' }), false);
  assert.equal(ok({ origin: 'http://127.0.0.1:3100' }), false, 'no Host header');
  assert.equal(ok({ host: 'localhost:3100', referer: 'http://localhost:3100/admin/' }), true);
  assert.equal(ok({ host: 'localhost:3100' }), false);
});

// ------------------------------------------------------------------- guard
test('guardStateChange: which requests are covered, in which order', () => {
  const g = (method, path, headers, e = env(SITE)) => util.guardStateChange(req(method, headers), path, e);
  const good = { origin: SITE, 'content-type': 'application/json', 'content-length': '2' };
  // only state-changing methods on /api/*
  for (const m of ['GET', 'HEAD', 'OPTIONS']) assert.equal(g(m, '/api/admin/tours', { origin: 'https://evil.example' }).ok, true, m);
  assert.equal(g('POST', '/tour/x', {}).ok, true, 'outside /api/');
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.deepEqual(g(m, '/api/admin/tours', { ...good, origin: 'https://evil.example' }), { ok: false, status: 403, error: 'forbidden_origin', reason: 'origin_not_allowed' }, m);
    assert.equal(g(m, '/api/admin/tours', good).ok, true, m);
  }
  // Origin (403) is decided before Content-Type (415)
  assert.equal(g('POST', '/api/x', { origin: 'https://evil.example', 'content-type': 'text/plain', 'content-length': '3' }).status, 403);
  assert.equal(g('POST', '/api/x', { origin: SITE, 'content-type': 'text/plain', 'content-length': '3' }).status, 415);
  assert.equal(g('POST', '/api/x', { origin: SITE, 'content-type': 'application/x-www-form-urlencoded', 'content-length': '3' }).status, 415);
  assert.equal(g('POST', '/api/x', { origin: SITE, 'content-length': '3' }).status, 415, 'a body with no type');
  assert.equal(g('POST', '/api/x', { origin: SITE, 'transfer-encoding': 'chunked' }).status, 415, 'a chunked body with no type');
  assert.equal(g('POST', '/api/x', { origin: SITE, 'content-type': 'text/plain' }).status, 415, 'a declared non-JSON type, even with no body');
  assert.equal(g('POST', '/api/x', { origin: SITE }).ok, true, 'no body and no type (e.g. logout)');
  assert.equal(g('POST', '/api/x', { origin: SITE, 'content-length': '0' }).ok, true);
  assert.equal(g('POST', '/api/x', { origin: SITE, 'content-type': 'application/json; charset=UTF-8', 'content-length': '2' }).ok, true);
  assert.equal(g('POST', '/api/x', { origin: SITE, 'content-type': 'Application/JSON', 'content-length': '2' }).ok, true);
  assert.equal(g('POST', '/api/x', { origin: SITE, 'content-type': 'application/jsonp', 'content-length': '2' }).status, 415);
  assert.equal(g('POST', '/api/x', { origin: SITE, 'content-type': 'multipart/form-data; boundary=a', 'content-length': '9' }).status, 415, 'multipart to a JSON route');
  // the two upload routes: multipart only
  for (const up of ['/api/admin/upload', '/api/partner/profiles/lodge-a/upload']) {
    assert.equal(g('POST', up, { origin: SITE, 'content-type': 'multipart/form-data; boundary=a', 'content-length': '9' }).ok, true, up);
    assert.equal(g('POST', up, { origin: SITE, 'content-type': 'application/json', 'content-length': '2' }).status, 415, up);
    assert.equal(g('POST', up, { origin: SITE }).status, 415, `${up} with no type`);
    assert.equal(g('POST', up, { origin: 'https://evil.example', 'content-type': 'multipart/form-data; boundary=a', 'content-length': '9' }).status, 403, `${up} is covered by the Origin check`);
  }
  assert.equal(g('POST', '/api/admin/upload/extra', { origin: SITE, 'content-type': 'multipart/form-data', 'content-length': '9' }).status, 415, 'only the exact upload routes are multipart');
});

// ----------------------------------------------------------------- cookies
test('parseCookies: the first duplicate wins (most specific Path is sent first); bad encoding does not throw', () => {
  assert.deepEqual(util.parseCookies({ headers: { cookie: 'a=1; b=2; a=3' } }), { a: '1', b: '2' });
  assert.equal(util.parseCookies({ headers: { cookie: 'chaacme_admin_session=new; chaacme_admin_session=legacy' } }).chaacme_admin_session, 'new');
  assert.doesNotThrow(() => util.parseCookies({ headers: { cookie: 'a=%E0%A4%A; b=ok' } }));
  assert.equal(util.parseCookies({ headers: { cookie: 'a=%E0%A4%A; b=ok' } }).b, 'ok');
  assert.deepEqual(util.parseCookies({ headers: {} }), {});
});

test('cookiePolicy: secure by default whatever NODE_ENV / FRONTEND_ORIGIN say; overrides are explicit and flagged', () => {
  for (const nodeEnv of ['production', 'development', 'test', undefined]) {
    for (const fo of ['https://chaacme.ir', undefined]) {
      const p = util.cookiePolicy({ NODE_ENV: nodeEnv, FRONTEND_ORIGIN: fo });
      assert.deepEqual([p.secure, p.userSameSite, p.overridden], [true, 'lax', false], `${nodeEnv}/${fo}`);
    }
  }
  assert.equal(util.cookiePolicy({ COOKIE_SECURE: 'false' }).secure, false);
  assert.equal(util.cookiePolicy({ COOKIE_SECURE: ' OFF ' }).secure, false);
  for (const junk of ['maybe', 'yes', '1', 'true', '']) assert.equal(util.cookiePolicy({ COOKIE_SECURE: junk }).secure, true, junk);
  assert.equal(util.cookiePolicy({ COOKIE_SAMESITE: 'strict' }).userSameSite, 'strict');
  assert.equal(util.cookiePolicy({ COOKIE_SAMESITE: 'garbage' }).userSameSite, 'lax');
  assert.equal(util.cookiePolicy({ COOKIE_SAMESITE: 'garbage' }).overridden, false);
  assert.equal(util.cookiePolicy({ COOKIE_SAMESITE: 'none' }).overridden, true);
});

test('sessionCookie: the exact attributes of each cookie', () => {
  const adm = util.sessionCookie('tok', { kind: 'admin', maxAgeSeconds: 60 });
  assert.equal(adm, 'chaacme_admin_session=tok; Path=/api/admin; HttpOnly; SameSite=Strict; Secure; Max-Age=60');
  const usr = util.sessionCookie('tok', { maxAgeSeconds: 60 });
  assert.equal(usr, 'chaacme_session=tok; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=60');
  assert.equal(util.sessionCookie('', { kind: 'admin', clear: true }), 'chaacme_admin_session=; Path=/api/admin; HttpOnly; SameSite=Strict; Secure; Max-Age=0');
  assert.equal(util.legacyAdminCookieClear(), 'chaacme_admin_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0');
});

// ------------------------------------------------------------- over HTTP
let admin, adminCookie, userCookie, tourId, editionId;
before(() => {
  db.seed();
  adminAuth.upsertAdminUser('root', 'pw-pw-pw-pw-1');
  admin = adminAuth.adminLogin('root', 'pw-pw-pw-pw-1');
  adminCookie = `chaacme_admin_session=${admin}`;
  const uid = Number(db.db.prepare("INSERT INTO users (phone, first_name, last_name, username) VALUES ('09120000009','a','b','csrf_user')").run().lastInsertRowid);
  userCookie = `chaacme_session=${auth.createSession(uid)}`;
  tourId = db.listTours().find((t) => !t.comingSoon).id;
  editionId = db.listEditionsAdmin(tourId)[0].id;
});
const send = (method, path, headers, body) => fetch(base + path, { method, headers, body });
const capacity = () => db.getTourDate(editionId).capacity;

test('over HTTP: the earlier CSRF proof now fails, and changes nothing', async () => {
  const before = capacity();
  // admin cookie + text/plain body + foreign Origin: the request that used to be honoured
  const r = await send('PUT', `/api/admin/tour-dates/${editionId}`, { cookie: adminCookie, 'content-type': 'text/plain', origin: 'https://evil.example' }, JSON.stringify({ capacity: 1 }));
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { error: 'forbidden_origin' });
  assert.equal(capacity(), before, 'unchanged');
  // the same body with the right Origin is refused for its type instead (still no change)
  const r2 = await send('PUT', `/api/admin/tour-dates/${editionId}`, { cookie: adminCookie, 'content-type': 'text/plain', origin: SITE }, JSON.stringify({ capacity: 1 }));
  assert.equal(r2.status, 415);
  assert.equal(capacity(), before);
  // and the real thing works
  const ok = await send('PUT', `/api/admin/tour-dates/${editionId}`, { cookie: adminCookie, 'content-type': 'application/json', origin: SITE }, JSON.stringify({ capacity: before + 1 }));
  assert.equal(ok.status, 200);
  assert.equal(capacity(), before + 1);
});

test('over HTTP: allowlist, www twin, scheme/port/subdomain tricks, Referer fallback', async () => {
  const put = (headers) => send('PUT', `/api/admin/tour-dates/${editionId}`, { cookie: adminCookie, 'content-type': 'application/json', ...headers }, JSON.stringify({ capacity: -1 }));
  // a request that passes the guard reaches validation (422); one that does not never gets that far
  assert.equal((await put({ origin: SITE })).status, 422);
  assert.equal((await put({ origin: 'https://www.chaacme.test' })).status, 422, 'www twin');
  for (const o of ['http://chaacme.test', 'https://chaacme.test:8443', 'https://sub.chaacme.test', 'https://chaacme.test.evil.example', 'null']) {
    assert.equal((await put({ origin: o })).status, 403, o);
  }
  assert.equal((await put({ referer: `${SITE}/admin/` })).status, 422, 'no Origin, own Referer');
  assert.equal((await put({ referer: 'https://evil.example/admin/' })).status, 403, 'no Origin, foreign Referer');
  assert.equal((await put({})).status, 403, 'neither');
});

test('over HTTP: user routes, partner routes and logins are all behind the guard', async () => {
  const jh = (extra) => ({ 'content-type': 'application/json', ...extra });
  for (const [m, p] of [['POST', '/api/bookings'], ['POST', '/api/auth/login'], ['POST', '/api/auth/signup'], ['POST', '/api/auth/logout'],
    ['POST', '/api/payments/zarinpal/request'], ['PUT', '/api/partner/profiles/x/revision'], ['DELETE', '/api/partner/profiles/x/revision'],
    ['POST', '/api/partner/proposals'], ['POST', '/api/host-applications'], ['POST', '/api/admin/login'], ['POST', '/api/admin/logout'],
    ['POST', '/api/admin/host-revisions/1/approve'], ['PUT', '/api/admin/hosts/1'], ['DELETE', '/api/admin/tours/x']]) {
    const foreign = await send(m, p, jh({ cookie: `${userCookie}; ${adminCookie}`, origin: 'https://evil.example' }), m === 'DELETE' ? undefined : '{}');
    assert.equal(foreign.status, 403, `${m} ${p} with a foreign Origin`);
    const none = await send(m, p, jh({ cookie: `${userCookie}; ${adminCookie}` }), m === 'DELETE' ? undefined : '{}');
    assert.equal(none.status, 403, `${m} ${p} with no Origin and no Referer`);
    const text = await send(m, p, { cookie: `${userCookie}; ${adminCookie}`, origin: SITE, 'content-type': 'text/plain' }, m === 'DELETE' ? undefined : '{}');
    assert.equal(text.status, 415, `${m} ${p} with text/plain`);
  }
});

test('over HTTP: login and logout cookies carry the new flags; the legacy admin cookie is deleted', async () => {
  const login = await send('POST', '/api/admin/login', { 'content-type': 'application/json', origin: SITE }, JSON.stringify({ username: 'root', password: 'pw-pw-pw-pw-1' }));
  assert.equal(login.status, 200);
  const set = login.headers.getSetCookie();
  assert.equal(set.length, 2);
  assert.match(set[0], /^chaacme_admin_session=[^;]+; Path=\/api\/admin; HttpOnly; SameSite=Strict; Secure; Max-Age=\d+$/);
  assert.equal(set[1], 'chaacme_admin_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0');
  const out = await send('POST', '/api/admin/logout', { origin: SITE });
  assert.equal(out.status, 200);
  const cleared = out.headers.getSetCookie();
  assert.ok(cleared.some((c) => c.includes('Path=/api/admin') && c.includes('Max-Age=0') && c.includes('SameSite=Strict')));
  assert.ok(cleared.some((c) => /Path=\/;/.test(c) && c.includes('Max-Age=0')));
  const ulogout = await send('POST', '/api/auth/logout', { origin: SITE });
  assert.equal(ulogout.headers.getSetCookie()[0], 'chaacme_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0');
});

test('over HTTP: a stale legacy admin cookie sent alongside the current one does not win', async () => {
  const headers = { 'content-type': 'application/json', origin: SITE };
  // browsers list the longer Path first: current cookie, then the legacy one
  const withBoth = await send('GET', '/api/admin/me', { cookie: `${adminCookie}; chaacme_admin_session=stale-legacy-value` });
  assert.equal(withBoth.status, 200);
  const legacyFirst = await send('GET', '/api/admin/me', { cookie: `chaacme_admin_session=stale-legacy-value; ${adminCookie}` });
  assert.equal(legacyFirst.status, 401, 'first one is read, so ordering matters and the bogus one loses nothing it should not');
  assert.ok(headers);
});

test('over HTTP: GET, HEAD and OPTIONS are untouched; CORS still grants only the configured origin', async () => {
  assert.equal((await send('GET', '/api/tours', { origin: 'https://evil.example' })).status, 200);
  assert.notEqual((await send('HEAD', '/api/tours', { origin: 'https://evil.example' })).status, 403, 'HEAD is not blocked by the guard');
  const pre = await send('OPTIONS', '/api/bookings', { origin: 'https://evil.example', 'access-control-request-method': 'POST' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), null);
  const own = await send('OPTIONS', '/api/bookings', { origin: SITE, 'access-control-request-method': 'POST' });
  assert.equal(own.headers.get('access-control-allow-origin'), SITE);
  // the ZarinPal return is a GET: unaffected, and it needs no cookie
  const cb = await fetch(`${base}/api/payments/zarinpal/callback?Authority=NOPE&Status=NOK`, { redirect: 'manual', headers: { origin: 'https://sandbox.zarinpal.com' } });
  assert.equal(cb.status, 302);
  assert.match(cb.headers.get('location'), new RegExp(`^${SITE}/booking/result\\?`));
});
