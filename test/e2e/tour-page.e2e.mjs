// Browser test for the server-rendered experience page.
//
//  * page is readable with JavaScript disabled
//  * booking card: not logged in -> sign-in redirect and back; logged in -> pick edition + party size ->
//    booking + (mocked) ZarinPal request -> gateway -> callback -> /booking/result still renders
//  * mobile (390px): sticky bar, jump to the card, collapsible itinerary, highlights scroller, no horizontal scroll
//  * lightbox opens/closes from the keyboard
//  * screenshots at 1440 and 390 of a full and a minimal fixture (generated gradient images, no real photos)
//
// Needs playwright-core and a chromium: PLAYWRIGHT_CORE=<path to playwright-core>, CHROMIUM_PATH=<chromium>,
// ImageMagick for the fixture images. E2E_OUT_DIR=<dir> to keep the screenshots.
import { mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { createServer as createHttpServer, request as httpRequest } from 'node:http';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'chaacme-tourpage-'));
const PORT = 5200 + Math.floor(Math.random() * 300);
const APP_PORT = PORT + 400;
const O = `http://127.0.0.1:${PORT}`;
const verified = [];

// ---- mocked ZarinPal --------------------------------------------------------------------------------------------
let counter = 0;
const mock = createHttpServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  let body = {}; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { /* ignore */ }
  const url = new URL(req.url, 'http://x');
  res.setHeader('content-type', 'application/json');
  if (req.method === 'POST' && url.pathname === '/pg/v4/payment/request.json') return res.end(JSON.stringify({ data: { code: 100, authority: `TP-AUTH-${++counter}`, fee: 0 }, errors: [] }));
  if (req.method === 'POST' && url.pathname === '/pg/v4/payment/verify.json') { verified.push(body.authority); return res.end(JSON.stringify({ data: { code: 100, ref_id: 800000 + counter }, errors: [] })); }
  const pay = /^\/pg\/StartPay\/(.+)$/.exec(url.pathname);
  if (req.method === 'GET' && pay) {
    res.setHeader('content-type', 'text/html');
    return res.end(`<!doctype html><title>gateway</title><p>Paid.</p><script>setTimeout(function(){ location.href = ${JSON.stringify(`${O}/api/payments/zarinpal/callback?Authority=${pay[1]}&Status=OK`)}; }, 50);</script>`);
  }
  res.statusCode = 404; res.end('{}');
});
await new Promise((r) => mock.listen(0, r));
const MOCK = `http://localhost:${mock.address().port}`;

Object.assign(process.env, {
  CHAACME_PLATFORM_DB: join(dir, 't.db'), IP_HASH_SALT: 'x'.repeat(24), OTP_PEPPER: 'y'.repeat(24),
  FRONTEND_STATIC_DIR: join(dir, 'images'), PORT: String(APP_PORT), HOST: '127.0.0.1', SERVE_STATIC: '1',
  FRONTEND_ORIGIN: O, SITE_ORIGIN: O,
  ZARINPAL_BASE_URL_OVERRIDE: MOCK, ZARINPAL_MERCHANT_ID: '11111111-1111-1111-1111-111111111111',
  ZARINPAL_CALLBACK_URL: `${O}/api/payments/zarinpal/callback`
});
const repo = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const { server } = await import(repo + '/server/index.js');
const db = await import(repo + '/server/db.js');
const upload = await import(repo + '/server/upload.js');
if (!server.listening) await new Promise((r) => server.once('listening', r));
db.seed();

// ---- fixtures: generated images only ---------------------------------------------------------------------------
let n = 0;
async function image(tourId, w = 2400, h = 1600) {
  const f = join(dir, `g${++n}.jpg`);
  const hue = ['#2f5d46-#dde7de', '#a84b24-#f0dccb', '#1f6b78-#d6e8ea', '#d9a23a-#f5e6c4', '#5f554a-#f6f1e8'][n % 5];
  execFileSync('convert', ['-size', `${w}x${h}`, `gradient:${hue}`, '-gravity', 'center', '-pointsize', '120', '-fill', 'white', '-annotate', '0', `${n}`, `jpeg:${f}`]);
  const b = `----f${n}`;
  const body = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="tourId"\r\n\r\n${tourId}\r\n--${b}\r\nContent-Disposition: form-data; name="file"; filename="x.jpg"\r\n\r\n`), readFileSync(f), Buffer.from(`\r\n--${b}--\r\n`)]);
  const r = Readable.from([body]); r.headers = { 'content-type': `multipart/form-data; boundary=${b}` };
  const out = await upload.handleUpload(r);
  assert.equal(out.status, 201);
  return out.path;
}
const future = (d) => db.todayIso(new Date(Date.now() + d * 864e5));
const person = db.createHost({ slug: 'ashkan', kind: 'person', displayName: 'آشکان', expertise: 'مربی انیمال فلو', bio: null, photoPath: null, instagramHandle: null, contactPhone: null, userId: null, status: 'active' });
const place = db.createHost({ slug: 'rustazendegi', kind: 'place', displayName: 'روستا زندگی', region: 'سه‌هزار، تنکابن', lodgingType: 'اقامتگاه بوم‌گردی',
  amenities: ['سکوی تمرین سرپوشیده', 'حوضچهٔ سنگی', 'اتاق با شومینه', 'غذای محلی'], photoPath: await image('hosts', 1600, 1000), bio: null, expertise: null, instagramHandle: null, contactPhone: null, userId: null, status: 'active' });
db.db.prepare("UPDATE hosts SET verified_at = datetime('now')").run();
const g = []; for (let i = 0; i < 7; i++) g.push(await image('fixture-retreat'));
db.createTour({
  id: 'fixture-retreat', status: 'published', name: 'ریتریت نمونه در جنگل', duration: '۳ روز و ۲ شب', price: 23000000, included: 'اقامت · غذا · جلسه‌ها',
  story: 'متن نمونهٔ داستان برای بررسی چیدمان صفحه. این متن فقط در تست است و هیچ‌جا منتشر نمی‌شود.', region: 'forest', experienceType: 'ریتریت حرکتی', level: 'مناسب همهٔ سطوح',
  bringList: 'لباس گرم', galleryImages: g.map((_, i) => `عکس ${i}`), galleryPhotos: g,
  highlights: ['جلسه‌های حرکتی روی سکو', 'سفرهٔ محلی', 'آب‌تنی در حوضچه', 'شب موسیقی', 'بازی روی چمن', 'پیاده‌روی صبحگاهی'].map((name, i) => ({ name, image: i < 3 ? g[i] : null, imageAlt: i < 3 ? name : null })),
  itinerary: [
    { time: 'روز ۱', title: 'رسیدن و آشنایی', description: 'متن نمونهٔ روز اول.', images: [{ path: g[3], alt: 'ورود' }] },
    { time: 'روز ۲', title: 'حرکت، جنگل، سفره', description: 'متن نمونهٔ روز دوم.', images: [{ path: g[4], alt: 'جنگل' }] },
    { time: 'روز ۳', title: 'جلسهٔ پایانی و بازگشت', description: 'متن نمونهٔ روز سوم.', images: [{ path: g[5], alt: 'میز' }] }
  ]
});
db.setTourHosts('fixture-retreat', [{ hostId: person.id, role: 'lead' }, { hostId: place.id, role: 'venue' }]);
db.addTourDate('fixture-retreat', { label: 'اجرای اول', capacity: 14, startsOn: future(30), endsOn: future(32) });
db.addTourDate('fixture-retreat', { label: 'اجرای دوم', capacity: 14, startsOn: future(60), endsOn: future(62) });
db.addTourDate('fixture-retreat', { label: 'اجرای سوم', capacity: 14, startsOn: future(90), endsOn: future(92) });
db.db.prepare('UPDATE tour_dates SET closed = 1 WHERE id = (SELECT MAX(id) FROM tour_dates)').run();
db.createTour({ id: 'fixture-minimal', status: 'published', name: 'تجربهٔ کمینه', price: 4200000 });
db.addTourDate('fixture-minimal', { label: 'تاریخ', capacity: 8, startsOn: future(15) });

// ---- a stand-in for nginx: /api, /tour, /assets, /images -> the app; everything else the SPA shell ---------------
const indexHtml = readFileSync(repo + '/deploy/index.html', 'utf8');
const front = createHttpServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (/^\/(api|tour|assets|images)\//.test(u.pathname)) {
    const up = httpRequest({ host: '127.0.0.1', port: APP_PORT, method: req.method, path: req.url, headers: req.headers }, (ur) => { res.writeHead(ur.statusCode, ur.headers); ur.pipe(res); });
    up.on('error', () => { res.statusCode = 502; res.end(); });
    return req.pipe(up);
  }
  res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(indexHtml);
});
await new Promise((r) => front.listen(PORT, '127.0.0.1', r));

const pw = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const chromium = pw.chromium || pw.default.chromium;
const outDir = process.env.E2E_OUT_DIR || join(tmpdir(), 'chaacme-tour-screenshots');
mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const errors = [];
const newCtx = async (opts = {}) => {
  const ctx = await browser.newContext(opts);
  await ctx.route('**/*', (r) => { const o = new URL(r.request().url()).origin; return (o === O || o === MOCK) ? r.continue() : r.abort(); });
  return ctx;
};

// ============================================================ 1. without JavaScript
{
  const ctx = await newCtx({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(`${O}/tour/fixture-retreat`);
  assert.equal(await page.textContent('h1'), 'ریتریت نمونه در جنگل');
  for (const t of ['متن نمونهٔ داستان', 'سفرهٔ محلی', 'متن نمونهٔ روز اول', 'روستا زندگی', 'آشکان', 'هنوز نظری ثبت نشده']) assert.ok((await page.content()).includes(t), `no-JS: ${t}`);
  assert.ok(await page.locator('.tp-hero__tile img').first().isVisible(), 'hero image visible without JS');
  await ctx.close();
  console.log('  ok  readable with JavaScript disabled');
}

// ============================================================ 2. desktop: screenshots, lightbox, booking
const ctx = await newCtx({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const api = (path, init) => page.evaluate(async ([p, i]) => { const r = await fetch('/api' + p, { credentials: 'same-origin', ...i }); return { status: r.status, body: await r.json().catch(() => null) }; }, [path, init]);
const post = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

await page.goto(`${O}/tour/fixture-retreat`);
await page.evaluate(() => document.fonts.ready);
await page.waitForLoadState('networkidle');
assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll at 1440');
assert.equal(await page.evaluate(() => getComputedStyle(document.body).fontFamily.includes('Vazirmatn') || getComputedStyle(document.querySelector('.ck-root')).fontFamily.includes('Vazirmatn')), true);
assert.ok(await page.evaluate(() => document.fonts.check('16px Vazirmatn', 'سلام')), 'Vazirmatn loaded from /assets');
await page.screenshot({ path: join(outDir, 'full-1440.png'), fullPage: true });

// lightbox from the keyboard
await page.locator('.tp-hero__tile').first().focus();
await page.keyboard.press('Enter');
assert.ok(await page.locator('dialog.tp-lb[open]').isVisible(), 'lightbox opens');
assert.match(await page.textContent('.tp-lb__count'), /۱ \/ ۷/);
await page.keyboard.press('ArrowLeft');
assert.match(await page.textContent('.tp-lb__count'), /۲ \/ ۷/);
await page.keyboard.press('Escape');
assert.equal(await page.locator('dialog.tp-lb[open]').count(), 0, 'Escape closes it');
console.log('  ok  lightbox: open, next (RTL), close');

// not logged in -> sign-in, then back to the page
const loginRequest = page.waitForRequest((r) => r.url() === `${O}/login?next=%2Ftour%2Ffixture-retreat`);
await page.locator('[data-submit]').click();
await loginRequest; // (the SPA rewrites the address bar to "/" as soon as it shows its sign-in screen)
await page.waitForSelector('#page-login.active');
const signup = await post('/auth/signup', { phone: '09121110077', firstName: 'سارا', lastName: 'تست', username: 'tour_user', password: 'Passw0rd!xyz' });
assert.equal(signup.status, 201);
await page.goto(`${O}/login?next=%2Ftour%2Ffixture-retreat`); // the SPA sees the session and returns to the server-rendered page
await page.waitForURL((u) => u.pathname === '/tour/fixture-retreat', { timeout: 15000 });
assert.ok(await page.locator('h1.tp-title').isVisible(), 'back on the server-rendered tour page');
await page.goto(`${O}/login?next=https%3A%2F%2Fevil.example%2F`); // an off-site next is ignored
await page.waitForSelector('#page-account.active, #page-login.active');
assert.equal(new URL(page.url()).hostname, '127.0.0.1');
console.log('  ok  not logged in: redirected to sign-in and returned; off-site next ignored');

// logged in: choose the second edition, two travellers
await page.goto(`${O}/tour/fixture-retreat`);
const radios = page.locator('input[name="edition"]');
assert.equal(await radios.count(), 3);
assert.equal(await radios.nth(2).isDisabled(), true, 'closed edition is disabled');
await radios.nth(1).check();
await page.selectOption('[data-guests]', '2');
assert.equal((await page.textContent('[data-total]')).trim(), '۴۶٬۰۰۰٬۰۰۰ تومان');
assert.ok(await page.locator('.tp-ed.is-selected').count() === 1);
const editionId = Number(await radios.nth(1).getAttribute('value'));
await page.locator('[data-submit]').click();
await page.waitForURL((u) => u.origin === O && u.pathname === '/booking/result', { timeout: 20000 });
await page.waitForFunction(() => /رزرو شما ثبت شد/.test(document.getElementById('bookingDoneTitle')?.textContent || ''), null, { timeout: 15000 });
const row = db.db.prepare('SELECT * FROM bookings ORDER BY id DESC LIMIT 1').get();
assert.deepEqual([row.tour_id, row.tour_date_id, row.guests, row.total, row.payment_status], ['fixture-retreat', editionId, 2, 46000000, 'paid']);
assert.equal(db.getTourDate(editionId).seats_taken, 2);
assert.equal(verified.length, 1);
console.log('  ok  booking: edition + party size -> booking -> gateway -> callback -> /booking/result');

// a second attempt on a full edition shows the message instead of redirecting
db.db.prepare('UPDATE tour_dates SET seats_taken = capacity WHERE id = ?').run(editionId);
await page.goto(`${O}/tour/fixture-retreat`); // rendered fresh (the app serves it uncached to this client)
await page.evaluate((id) => { const r = document.querySelector(`input[name="edition"][value="${id}"]`); r.disabled = false; r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }, editionId);
await page.locator('[data-submit]').click();
await page.waitForSelector('.tp-book .ck-notice--error:not([hidden])');
assert.match(await page.textContent('.tp-book .ck-notice--error'), /ظرفیت این تاریخ تکمیل شده است/);
assert.equal(new URL(page.url()).pathname, '/tour/fixture-retreat');
console.log('  ok  full edition: error shown, no redirect');
await ctx.close();

// ============================================================ 3. mobile
{
  const mctx = await newCtx({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await mctx.newPage();
  m.on('pageerror', (e) => errors.push(String(e)));
  await m.goto(`${O}/tour/fixture-retreat`);
  await m.evaluate(() => document.fonts.ready);
  await m.waitForLoadState('networkidle');
  assert.equal(await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll at 390');
  assert.equal(await m.locator('.ck-site-header').isVisible(), false);
  assert.ok(await m.locator('.tp-sticky').isVisible(), 'sticky bar');
  assert.match(await m.textContent('.tp-sticky'), /۲۳٬۰۰۰٬۰۰۰ تومان \/ نفر/);
  assert.equal(await m.locator('.tp-days').isVisible(), false);
  assert.equal(await m.locator('.tp-acc__item').count(), 3);
  assert.deepEqual(await m.locator('.tp-acc__item').evaluateAll((els) => els.map((e) => e.open)), [true, false, false], 'first day open');
  assert.ok(await m.locator('.tp-hl-scroll').isVisible(), 'highlights scroller');
  assert.equal(await m.locator('.tp-hl').isVisible(), false);
  assert.ok(await m.evaluate(() => document.querySelector('.tp-hl-scroll').scrollWidth > document.querySelector('.tp-hl-scroll').clientWidth), 'scrolls horizontally');
  await m.screenshot({ path: join(outDir, 'full-390.png'), fullPage: true });
  // collapsible day
  await m.locator('.tp-acc__item summary').nth(1).tap();
  assert.equal(await m.locator('.tp-acc__item').nth(1).evaluate((e) => e.open), true);
  // sticky bar -> booking card
  await m.locator('[data-jump-booking]').tap();
  await m.waitForTimeout(800);
  const box = await m.locator('#booking').boundingBox();
  assert.ok(box && box.y >= -2 && box.y < 400, `booking card scrolled into view (y=${box && box.y})`);
  const tall = await m.locator('[data-jump-booking]').boundingBox();
  assert.ok(tall.height >= 44 && tall.width >= 44, 'touch target >= 44px');
  const small = await m.evaluate(() => Array.from(document.querySelectorAll('a, button, summary, label.tp-ed')).filter((e) => e.offsetParent !== null).map((e) => { const r = e.getBoundingClientRect(); return [e.className || e.tagName, r.width, r.height]; }).filter(([, w, h]) => h < 44 && w > 0 && h > 0));
  console.log('  info  interactive elements under 44px tall on mobile:', JSON.stringify(small.slice(0, 8)));
  await mctx.close();
  console.log('  ok  mobile: stacked, sticky bar, collapsible days, scroller, jump to card');
}

// ============================================================ 4. minimal fixture screenshots
for (const [name, viewport] of [['minimal-1440', { width: 1440, height: 900 }], ['minimal-390', { width: 390, height: 844 }]]) {
  const c = await newCtx({ viewport, deviceScaleFactor: viewport.width < 500 ? 2 : 1 });
  const p = await c.newPage();
  await p.goto(`${O}/tour/fixture-minimal`);
  await p.evaluate(() => document.fonts.ready);
  await p.waitForLoadState('networkidle');
  await p.screenshot({ path: join(outDir, `${name}.png`), fullPage: true });
  await c.close();
}

await browser.close();
mock.close(); front.close(); server.close();
const real = errors.filter((e) => !/Failed to load resource|ERR_|net::/.test(e));
assert.deepEqual(real, [], 'no page errors: ' + real.join(' | '));
console.log('E2E OK ->', outDir);
