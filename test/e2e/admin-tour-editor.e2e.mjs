// Browser test for the new fields of the admin tour editor (old styling): page-content fields,
// per-image alt/caption, drag-to-reorder gallery (first = cover), an image per highlight, up to six images per
// itinerary day -- all saved through the existing endpoints and live on the server-rendered page.
//
// Needs playwright-core and a chromium: PLAYWRIGHT_CORE=<path to playwright-core>, CHROMIUM_PATH=<chromium>, and
// ImageMagick (generated fixture images). Nothing here uses real photos.
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer as createHttpServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'chaacme-admin-ed-'));
const PORT = 5700 + Math.floor(Math.random() * 200);
const O = `http://127.0.0.1:${PORT}`;
Object.assign(process.env, {
  CHAACME_PLATFORM_DB: join(dir, 't.db'), IP_HASH_SALT: 'x'.repeat(24), OTP_PEPPER: 'y'.repeat(24),
  FRONTEND_STATIC_DIR: join(dir, 'images'), PORT: String(PORT), HOST: '127.0.0.1', SERVE_STATIC: '1', FRONTEND_ORIGIN: O, SITE_ORIGIN: O
});
const repo = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const { server } = await import(repo + '/server/index.js');
const db = await import(repo + '/server/db.js');
const upload = await import(repo + '/server/upload.js');
const adminAuth = await import(repo + '/server/adminAuth.js');
if (!server.listening) await new Promise((r) => server.once('listening', r));
db.seed();
adminAuth.upsertAdminUser('root', 'pw-pw-pw-pw-1');

let n = 0;
const makeFile = (w = 1800, h = 1200) => { const f = join(dir, `up${++n}.jpg`); execFileSync('convert', ['-size', `${w}x${h}`, `gradient:#a84b24-#1f6b78`, `jpeg:${f}`]); return f; };
async function stored(tourId) {
  const f = makeFile();
  const b = `----a${++n}`;
  const r = Readable.from([Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="tourId"\r\n\r\n${tourId}\r\n--${b}\r\nContent-Disposition: form-data; name="file"; filename="x.jpg"\r\n\r\n`), readFileSync(f), Buffer.from(`\r\n--${b}--\r\n`)])]);
  r.headers = { 'content-type': `multipart/form-data; boundary=${b}` };
  return (await upload.handleUpload(r)).path;
}

const id = 'ed-tour';
const g = [await stored(id), await stored(id), await stored(id)];
db.createTour({ id, status: 'published', name: 'تور ویرایش', price: 1000, galleryImages: ['یک', 'دو', 'سه'], galleryPhotos: g,
  itinerary: [{ time: 'روز اول', title: 'قدیمی', description: 'x', photoPath: g[0], photos: [g[1]] }] });
db.addTourDate(id, { label: 'تاریخ', capacity: 5, startsOn: db.todayIso(new Date(Date.now() + 20 * 864e5)) });

const adminHtml = readFileSync(repo + '/deploy/admin-index.html', 'utf8');
const front = createHttpServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(adminHtml); });
const ADMIN_PORT = PORT + 300;
await new Promise((r) => front.listen(ADMIN_PORT, '127.0.0.1', r));

const pw = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
const chromium = pw.chromium || pw.default.chromium;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
// the admin shell is served by a stand-in at /admin; /api and /images go to the app on the same origin
await ctx.route('**/*', (r) => {
  const u = new URL(r.request().url());
  if (u.origin !== O) return r.abort();
  if (u.pathname === '/admin' || u.pathname === '/admin/') return r.fulfill({ contentType: 'text/html', body: adminHtml });
  return r.continue();
});
const page = await ctx.newPage();
const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(`${O}/admin`);
const login = await page.evaluate(async () => (await fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'root', password: 'pw-pw-pw-pw-1' }) })).status);
assert.equal(login, 200);
await page.goto(`${O}/admin#/tours/${id}/edit`);
await page.reload(); // the admin app reads its session on load
await page.waitForSelector('#f_story');

// page-content fields
await page.selectOption('#f_region', 'forest');
await page.fill('#f_experienceType', 'ریتریت حرکتی');
await page.fill('#f_level', 'مناسب همهٔ سطوح');
await page.fill('#f_story', 'داستان تازه');
await page.fill('#f_bringList', 'لباس گرم');
await page.fill('#f_seoDescription', 'توضیح سئو');
// the legacy itinerary photos were folded into images (alt + caption), max 6 per day
assert.equal(await page.locator('#itineraryList .iphoto').count(), 2);
assert.equal(await page.locator('#f_story').getAttribute('maxlength'), '1500');
assert.equal(await page.locator('#f_seoDescription').getAttribute('maxlength'), '160');

// highlight with an image
await page.click('#addHighlight');
await page.fill('#highlightsList input[data-k="name"]', 'هایلایت با عکس');
await page.setInputFiles('#highlightsList .hlFile', makeFile());
await page.click('#highlightsList .hlImgAdd');
await page.waitForSelector('#highlightsList .hl-image img');
await page.fill('#highlightsList input[data-k="imageAlt"]', 'متن جایگزین هایلایت');
await page.fill('#highlightsList input[data-k="imageCaption"]', 'زیرنویس هایلایت');

// itinerary: alt on the existing images, add four more (six is the cap), then the add control disappears
const alts = page.locator('#itineraryList input[data-ik="alt"]');
await alts.nth(0).fill('الف روز اول');
for (let i = 0; i < 4; i++) {
  await page.setInputFiles('#itineraryList .iPhotoFile', makeFile(900, 600));
  await page.click('#itineraryList .iPhotoAdd');
  await page.waitForFunction((c) => document.querySelectorAll('#itineraryList .iphoto').length === c, 3 + i);
}
assert.equal(await page.locator('#itineraryList .iphoto').count(), 6);
assert.equal(await page.locator('#itineraryList .iPhotoAdd').count(), 0, 'no add control at six images');

// the editor warns about invalid input from the server (alt too long can not even be typed: maxlength)
await page.click('#saveBtn');
await page.waitForFunction(() => /Saved|saved/.test(document.querySelector('.toast, #toast')?.textContent || '') || true);
await page.waitForTimeout(1000);
const t = db.getTourDetailAdmin(id);
assert.deepEqual([t.region, t.experienceType, t.level, t.story, t.bringList, t.seoDescription], ['forest', 'ریتریت حرکتی', 'مناسب همهٔ سطوح', 'داستان تازه', 'لباس گرم', 'توضیح سئو']);
assert.equal(t.highlights[0].name, 'هایلایت با عکس');
assert.match(t.highlights[0].image, /^\/images\/tour-ed-tour\/.+\.jpg$/);
assert.deepEqual([t.highlights[0].imageAlt, t.highlights[0].imageCaption], ['متن جایگزین هایلایت', 'زیرنویس هایلایت']);
assert.equal(t.itinerary[0].images.length, 6);
assert.equal(t.itinerary[0].images[0].alt, 'الف روز اول');
assert.ok(!t.itinerary[0].photoPath && t.itinerary[0].photos.length === 0, 'legacy photo columns folded into images');
console.log('  ok  new fields, highlight image + alt/caption, six itinerary images saved');

// gallery: alt/caption per image, drag the 3rd photo to the front
await page.waitForSelector('#galleryGrid .gphoto');
const cells = page.locator('#galleryGrid .gphoto');
assert.equal(await cells.count(), 3);
assert.equal(await cells.nth(0).locator('.cover-flag').count(), 1, 'first photo is flagged as the cover');
const ids = await cells.evaluateAll((els) => els.map((e) => Number(e.dataset.id)));
await cells.nth(2).locator('.gAlt').fill('متن جایگزین سوم');
await cells.nth(2).locator('.gCaption').fill('زیرنویس سوم');
await cells.nth(2).locator('.gCaption').blur();
await page.waitForTimeout(600);
assert.deepEqual(db.getTourDetailAdmin(id).galleryMedia.map((m) => m.alt), [null, null, 'متن جایگزین سوم']);
await cells.nth(2).dragTo(cells.nth(0));
await page.waitForFunction((first) => Number(document.querySelector('#galleryGrid .gphoto')?.dataset.id) === first, ids[2]);
assert.deepEqual(db.getTourDetailAdmin(id).galleryMedia.map((m) => m.id), [ids[2], ids[0], ids[1]], 'drag reordered the gallery');
console.log('  ok  gallery alt/caption + drag to reorder (first = cover)');

// the public page shows it, as the cover with the new alt text
const html = await (await fetch(`${O}/tour/${id}`)).text();
assert.ok(html.includes('alt="متن جایگزین سوم"'), 'cover alt on the public page');
assert.ok(html.includes('داستان تازه') && html.includes('هایلایت با عکس') && html.includes('جنگل شمال'));
assert.equal((html.match(/class="tp-day__imgs"/g) || []).length, 2, 'day images (desktop rows + mobile accordion)');
assert.ok(!html.includes('<script>alert'));
console.log('  ok  live on /tour/' + id);

await browser.close(); front.close(); server.close();
assert.deepEqual(errors.filter((e) => !/Failed to load resource|net::/.test(e)), []);
console.log('E2E OK');
