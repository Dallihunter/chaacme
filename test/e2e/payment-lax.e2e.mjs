// Browser test for the cookie/CSRF hardening, with a REAL cross-site hop:
//   the app is on http://127.0.0.1:<port>, the mocked ZarinPal and an "attacker" page are on
//   http://localhost:<port2>. Different hostnames are different SITES for cookie purposes.
//
//   1. A logged-in user pays: browser -> mock gateway (cross-site) -> 302 -> GET /api/payments/zarinpal/callback
//      -> 302 -> /booking/result. With SameSite=Lax the cookie is sent on that top-level GET navigation and the
//      user is still logged in on the result page. (The production flow uses the real gateway the same way.)
//   2. A forged cross-site <form> POST (text/plain, the classic CSRF) against an admin route and a user route:
//      the browser does NOT send the cookies (Strict / Lax) and the server ALSO refuses it (403, foreign Origin).
//
// Needs playwright-core and a chromium: PLAYWRIGHT_CORE=<path to playwright-core>, CHROMIUM_PATH=<chromium>.
import { mkdtempSync, readFileSync, mkdirSync } from 'node:fs';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'chaacme-lax-'));
const PORT = 4800 + Math.floor(Math.random() * 300);   // the SITE: what the browser sees (a stand-in for nginx)
const APP_PORT = PORT + 400;                             // the app, behind it
const O = `http://127.0.0.1:${PORT}`;

// --- mocked ZarinPal on a different site (localhost) ------------------------------------------------
let counter = 0;
const verified = [];
const mock = createHttpServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  let body = {};
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { /* ignore */ }
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/pg/v4/payment/request.json') {
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ data: { code: 100, authority: `LAX-AUTHORITY-${++counter}`, fee: 0 }, errors: [] }));
  }
  if (req.method === 'POST' && url.pathname === '/pg/v4/payment/verify.json') {
    verified.push(body.authority);
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ data: { code: 100, ref_id: 700000 + counter }, errors: [] }));
  }
  const pay = /^\/pg\/StartPay\/(.+)$/.exec(url.pathname);
  if (req.method === 'GET' && pay) { // the gateway's own page; "the user paid", and the page sends them back to the merchant.
    // The navigation back is initiated BY A PAGE ON THE GATEWAY'S SITE, so for the browser it is a cross-site
    // top-level GET navigation (Sec-Fetch-Site: cross-site) -- exactly what the real return from ZarinPal is.
    res.setHeader('content-type', 'text/html');
    return res.end(`<!doctype html><title>gateway</title><p>Paid.</p><script>
      setTimeout(function(){ location.href = ${JSON.stringify(`${O}/api/payments/zarinpal/callback?Authority=${pay[1]}&Status=OK`)}; }, 50);</script>`);
  }
  if (req.method === 'GET' && url.pathname === '/evil') { // the attacker's page: auto-submitting cross-site forms
    const target = (path) => `${O}${path}`;
    res.setHeader('content-type', 'text/html');
    return res.end(`<!doctype html><body>
      <form id="admin" method="POST" action="${target(url.searchParams.get('admin'))}" enctype="text/plain">
        <input name='{"capacity":1,"pad":"' value='"}'></form>
      <form id="user" method="POST" action="${target('/api/bookings')}" enctype="text/plain">
        <input name='{"tourId":"x","pad":"' value='"}'></form>
      <script>document.getElementById(new URLSearchParams(location.search).get('go')).submit()</script></body>`);
  }
  res.statusCode = 404; res.end('{}');
});
await new Promise((r) => mock.listen(0, r)); // dual-stack: reachable as "localhost" over v4 or v6
const MOCK = `http://localhost:${mock.address().port}`;

Object.assign(process.env, {
  CHAACME_PLATFORM_DB: join(dir, 't.db'), IP_HASH_SALT: 'x'.repeat(24), OTP_PEPPER: 'y'.repeat(24),
  FRONTEND_STATIC_DIR: join(dir, 'images'), PORT: String(APP_PORT), HOST: '127.0.0.1',
  FRONTEND_ORIGIN: O,                                    // production-like: the write guard runs in allowlist mode
  ZARINPAL_BASE_URL_OVERRIDE: MOCK,                      // the server calls the mock gateway...
  ZARINPAL_MERCHANT_ID: '11111111-1111-1111-1111-111111111111',
  ZARINPAL_CALLBACK_URL: `${O}/api/payments/zarinpal/callback`,
  BOOKING_ONLINE_ENABLED: 'true'                         // the payment flow itself is under test
});
const repo = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const { server } = await import(repo + '/server/index.js');
const db = await import(repo + '/server/db.js');
const adminAuth = await import(repo + '/server/adminAuth.js');
if (!server.listening) await new Promise((r) => server.once('listening', r));
db.seed();
adminAuth.upsertAdminUser('root', 'pw-pw-pw-pw-1');
const tour = db.listTours().find((t) => !t.comingSoon);
const edition = db.listEditionsAdmin(tour.id)[0];

// A stand-in for nginx, so the redirect chain behaves exactly as in production: every path proxied to the app
// with the original Host and Cookie/Origin headers (the app renders the pages itself).
const wire = []; // what the server really RECEIVED from the browser (headers the browser actually sent)
const front = createHttpServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  {
    if (u.pathname.startsWith('/api/')) wire.push({ method: req.method, url: req.url, cookie: req.headers.cookie || '', origin: req.headers.origin || '',
      site: req.headers['sec-fetch-site'] || '', mode: req.headers['sec-fetch-mode'] || '', dest: req.headers['sec-fetch-dest'] || '' });
    const up = httpRequest({ host: '127.0.0.1', port: APP_PORT, method: req.method, path: req.url, headers: req.headers },
      (ur) => { res.writeHead(ur.statusCode, ur.headers); ur.pipe(res); });
    up.on('error', () => { res.statusCode = 502; res.end(); });
    return req.pipe(up);
  }
});
await new Promise((r) => front.listen(PORT, '127.0.0.1', r));
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const outDir = process.env.E2E_OUT_DIR || join(homedir(), 'chaacme-verification', `${new Date().toISOString().slice(0, 10)}-payment-lax`);
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
await ctx.route('**/*', (r) => { const o = new URL(r.request().url()).origin; return (o === O || o === MOCK) ? r.continue() : r.abort(); });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const fetchJson = (path, init) => page.evaluate(async ([p, i]) => {
  const r = await fetch('/api' + p, { credentials: 'same-origin', ...i });
  return { status: r.status, body: await r.json().catch(() => null), setCookie: null };
}, [path, init]);
const post = (path, body) => fetchJson(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

// ============================================================ 1. the payment round trip
await page.goto(O + '/');
const signup = await post('/auth/signup', { phone: '09121110099', firstName: 'سارا', lastName: 'تست', username: 'lax_user', password: 'Passw0rd!xyz' });
assert.equal(signup.status, 201, 'signup through the real page (Origin = the site)');
const cookies = await ctx.cookies(); // (cookies(url) hides Secure cookies for an http:// URL)
const userCookie = cookies.find((c) => c.name === 'chaacme_session');
assert.ok(userCookie, 'session cookie stored by the browser');
assert.equal(userCookie.sameSite, 'Lax', 'user cookie is SameSite=Lax');
assert.equal(userCookie.httpOnly, true);
assert.equal(userCookie.secure, true, 'Secure by default (Chromium accepts it for localhost-class hosts)');
assert.equal(userCookie.path, '/');

const open = (await fetchJson(`/tours/${tour.id}`)).body.tour.bookingDates.find((d) => !d.disabled);
const booking = await post('/bookings', { tourId: tour.id, tourDateId: open.id, guests: 1 });
assert.equal(booking.status, 201);
const pay = await post('/payments/zarinpal/request', { bookingId: booking.body.booking.id });
assert.equal(pay.status, 200);
assert.ok(pay.body.redirectUrl.startsWith(MOCK + '/pg/StartPay/'), 'sent to the (cross-site) gateway: ' + pay.body.redirectUrl);
const bookingRef = booking.body.booking.ref;

wire.length = 0;
await page.evaluate((u) => { window.location.href = u; }, pay.body.redirectUrl); // exactly what the SPA does
// merchant (127.0.0.1) -> gateway page (localhost) -> gateway page navigates back -> callback -> 302 -> /booking/result
await page.waitForURL((u) => u.origin === O && u.pathname === '/booking/result', { timeout: 15000 });
await page.waitForSelector('.br-list', { timeout: 15000 })
  .catch((e) => { // say where the browser ended up, instead of just timing out
    console.error('result page not rendered; url:', page.url(), '| wire:', JSON.stringify(wire.map((x) => [x.method, x.url, x.site])), '| verified:', verified);
    throw e;
  });
const cb = wire.find((s) => s.url.includes('/api/payments/zarinpal/callback'));
assert.ok(cb, 'the browser called the callback');
assert.equal(cb.site, 'cross-site', 'the callback navigation was initiated cross-site (Sec-Fetch-Site as the server received it): ' + JSON.stringify(cb));
assert.equal(cb.mode, 'navigate'); assert.equal(cb.dest, 'document');
assert.match(cb.cookie, /chaacme_session=/, 'SameSite=Lax: the cookie IS sent on a cross-site top-level GET navigation');
assert.equal(verified.length, 1, 'the server verified the payment with the gateway');
const me = await fetchJson('/auth/me');
assert.equal(me.status, 200, 'still logged in on the result page');
assert.equal(me.body.user.username, 'lax_user');
assert.ok((await page.textContent('.br-list')).includes(bookingRef), 'the booking reference is shown on the result page');
const mine = (await fetchJson('/bookings/me')).body;
const paid = JSON.stringify(mine).includes(bookingRef);
assert.ok(paid, 'the booking is listed for the returning user');
assert.equal(db.db.prepare('SELECT payment_status s FROM bookings WHERE ref = ?').get(bookingRef).s, 'paid', 'and is marked paid');
await page.screenshot({ path: join(outDir, '1-payment-return-logged-in.png') });
console.log('  ok  payment return from a cross-site gateway works with SameSite=Lax; user still logged in');

// ============================================================ 2. forged cross-site POSTs
await page.goto(O + '/');
const adminLogin = await post('/admin/login', { username: 'root', password: 'pw-pw-pw-pw-1' });
assert.equal(adminLogin.status, 200);
const adminCookie = (await ctx.cookies()).find((c) => c.name === 'chaacme_admin_session');
assert.ok(adminCookie, 'admin cookie stored');
assert.equal(adminCookie.sameSite, 'Strict');
assert.equal(adminCookie.httpOnly, true);
assert.equal(adminCookie.secure, true);
assert.equal(adminCookie.path, '/api/admin', 'admin cookie is limited to /api/admin');
const capBefore = db.getTourDate(edition.id).capacity;
const countBefore = db.db.prepare('SELECT COUNT(*) c FROM bookings').get().c;

async function forge(go, adminPath) {
  wire.length = 0;
  const responded = page.waitForResponse((r) => r.url().startsWith(O + '/api/') && r.request().method() === 'POST', { timeout: 15000 });
  await page.goto(`${MOCK}/evil?go=${go}&admin=${encodeURIComponent(adminPath)}`);
  const resp = await responded;
  const sent = wire.find((s) => s.method === 'POST' && s.url.startsWith('/api/'));
  return { status: resp.status(), body: await resp.json().catch(() => null), sent };
}
const adminForge = await forge('admin', `/api/admin/tour-dates/${edition.id}`);
assert.equal(adminForge.sent?.site, 'cross-site', 'the forged form really is cross-site');
assert.ok(adminForge.sent?.origin.startsWith('http://localhost:'), 'with the attacker as Origin: ' + adminForge.sent?.origin);
assert.ok(!/chaacme_admin_session/.test(adminForge.sent?.cookie), 'layer 1 -- SameSite=Strict: the admin cookie was NOT sent: ' + adminForge.sent?.cookie);
assert.equal(adminForge.status, 403, 'layer 2 -- the guard refuses the foreign Origin anyway');
assert.equal(adminForge.body?.error, 'forbidden_origin');
const userForge = await forge('user', '/api/x');
assert.ok(!/chaacme_session/.test(userForge.sent?.cookie), 'layer 1 -- SameSite=Lax: the user cookie is NOT sent on a cross-site POST: ' + userForge.sent?.cookie);
assert.equal(userForge.status, 403, 'layer 2 -- 403 for the foreign Origin');
assert.equal(db.getTourDate(edition.id).capacity, capBefore, 'the admin forgery changed nothing');
assert.equal(db.db.prepare('SELECT COUNT(*) c FROM bookings').get().c, countBefore, 'the user forgery created nothing');
console.log('  ok  forged cross-site form POSTs: cookies not sent (Strict/Lax) AND refused with 403; nothing changed');

// the same request made from the real site still works (control: the guard is not simply refusing everything)
await page.goto(O + '/');
const legit = await fetchJson(`/admin/tour-dates/${edition.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ capacity: capBefore + 2 }) });
assert.equal(legit.status, 200, 'control: the same admin write from the real origin works');
assert.equal(db.getTourDate(edition.id).capacity, capBefore + 2);

await browser.close();
mock.close(); front.close(); server.close();
const real = errors.filter((e) => !/Failed to load resource|ERR_/.test(e));
assert.deepEqual(real, [], 'no page errors');
console.log('E2E OK ->', outDir);
