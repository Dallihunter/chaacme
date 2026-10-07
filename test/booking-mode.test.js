// Per-tour reservation mode (online | external | none), the reservation link rules, the «تهران» region and the
// role label of a partner link. Pure checks first, then the real server (admin API + rendered pages).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'chaacme-bm-'));
const PORT = 6800 + Math.floor(Math.random() * 300);
delete process.env.BOOKING_ONLINE_ENABLED;
Object.assign(process.env, {
  CHAACME_PLATFORM_DB: join(dir, 't.db'), IP_HASH_SALT: 'x'.repeat(24), OTP_PEPPER: 'y'.repeat(24), FRONTEND_STATIC_DIR: join(dir, 'images'),
  PORT: String(PORT), HOST: '127.0.0.1', FRONTEND_ORIGIN: 'https://example.test', SITE_ORIGIN: 'https://example.test'
});
const { server } = await import('../server/index.js');
const db = await import('../server/db.js');
const adminAuth = await import('../server/adminAuth.js');
const { checkBookingUrl, checkBookingText, bookingLink, BOOKING_LIMITS, DEFAULT_BOOKING_LABEL } = await import('../deploy/assets/js/shared/booking.js');
const { formatCardDateFa, formatDateRangeFa } = await import('../deploy/assets/js/shared/format.js');
const { REGIONS, REGION_KEYS } = await import('../deploy/assets/js/shared/regions.js');
const { validateRoleLabel } = await import('../server/util.js');
const base = `http://127.0.0.1:${PORT}`;
const ROOT = fileURLToPath(new URL('..', import.meta.url));

before(async () => { if (!server.listening) await new Promise((r) => server.once('listening', r)); });
after(() => server.close());

const admin = adminAuth.adminLogin((adminAuth.upsertAdminUser('root', 'pw-pw-pw-pw'), 'root'), 'pw-pw-pw-pw');
const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: { origin: 'https://example.test', cookie: `chaacme_admin_session=${admin}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, text, data };
};
const get = async (path) => { const res = await fetch(base + path); return { status: res.status, text: await res.text() }; };
const future = (days) => db.todayIso(new Date(Date.now() + days * 864e5));
const headOf = (html) => html.slice(html.indexOf('<head>'), html.indexOf('</head>'));
const mainOf = (html) => html.slice(html.indexOf('<main'), html.indexOf('</main>'));
const SHORT = '"><img src=x onerror=alert(1)>';           // fits the 40-character fields
const ESC_SHORT = '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;';

// ------------------------------------------------------------------------------------------- the link rules
const URL_VECTORS = [
  // [input, error | null (accepted), normalised value]
  ['https://example.com', null, 'https://example.com'],
  ['https://example.com/book?x=1&y=2#frag', null, 'https://example.com/book?x=1&y=2#frag'],
  ['  https://example.com/book  ', null, 'https://example.com/book'],
  ['HTTPS://Example.com/Path', null, 'https://Example.com/Path'],
  ['https://رزرو.ایران/', null, 'https://رزرو.ایران/'],
  ['tel:+989121234567', null, 'tel:+989121234567'],
  ['TEL:021-1234-5678', null, 'tel:021-1234-5678'],
  ['tel:(021)12345678', null, 'tel:(021)12345678'],
  ['mailto:info@example.com', null, 'mailto:info@example.com'],
  ['MAILTO:info@example.com?subject=Bazm%20Vol.02', null, 'mailto:info@example.com?subject=Bazm%20Vol.02'],
  ['javascript:alert(1)', 'scheme'], ['JaVaScRiPt:alert(1)', 'scheme'], ['  javascript:alert(1)', 'scheme'], ['javascript://%0Aalert(1)', 'scheme'],
  ['data:text/html,hello', 'scheme'], ['data:text/html;base64,PHNjcmlwdD4=', 'scheme'], ['vbscript:msgbox(1)', 'scheme'], ['file:///etc/passwd', 'scheme'],
  ['http://example.com', 'scheme'], ['HTTP://example.com', 'scheme'], ['ftp://example.com', 'scheme'], ['//evil.example/x', 'scheme'],
  ['/relative/path', 'scheme'], ['example.com/book', 'scheme'], ['www.example.com', 'scheme'], ['sms:+989121234567', 'scheme'], ['whatsapp://send?phone=1', 'scheme'],
  ['data:text/html,x', 'scheme'], ['data:text/html,<script>alert(1)</script>', 'format'],
  ['https:example.com', 'format'], ['https://', 'format'], ['https:///path', 'format'], ['https://?x=1', 'format'],
  ['https://user:pw@example.com', 'format'], ['https://user@example.com', 'format'],
  ['https://exa mple.com', 'format'], ['https://example.com/\nfoo', 'format'], ['https://example.com/\tfoo', 'format'], ['https://example.com/\u0000', 'format'],
  ['https://example.com/a\u2028b', 'format'], ['https://example.com/a\\b', 'format'],
  ['https://example.com/"onmouseover="x', 'format'], ["https://example.com/'", 'format'], ['https://example.com/<b>', 'format'], ['https://example.com/`', 'format'],
  ['https://', 'format'], ['', 'format'], ['   ', 'format'],
  ['tel:abc', 'format'], ['tel:12', 'format'], ['tel:', 'format'], ['tel:+98 912 123', 'format'], ['tel:+989121234567;ext=1', 'format'], ['tel:javascript:alert(1)', 'format'],
  ['mailto:', 'format'], ['mailto:a@b', 'format'], ['mailto:a@example.com,c@example.org', 'format'], ['mailto:a b@example.com', 'format'], ['mailto:info@example.com?subject=<x>', 'format'],
  [`https://example.com/${'a'.repeat(300)}`, 'length'],
  [null, 'type'], [undefined, 'type'], [5, 'type'], [{}, 'type'], [['https://example.com'], 'type']
];

test('checkBookingUrl: only https://, tel: and mailto: pass; every other scheme and every unsafe character is refused', () => {
  for (const [input, error, value] of URL_VECTORS) {
    const r = checkBookingUrl(input);
    if (error) assert.deepEqual([r.ok, r.error], [false, error], JSON.stringify(input));
    else assert.deepEqual([r.ok, r.value], [true, value], JSON.stringify(input));
  }
  // exactly 300 is fine, 301 is not
  const edge = `https://example.com/${'a'.repeat(300 - 20)}`;
  assert.equal(edge.length, 300);
  assert.equal(checkBookingUrl(edge).ok, true);
  assert.equal(checkBookingUrl(`${edge}a`).error, 'length');
  // the link the page uses: https opens a new tab, tel: and mailto: do not; anything else is null
  assert.deepEqual(bookingLink('https://example.com/x'), { href: 'https://example.com/x', newTab: true });
  assert.deepEqual(bookingLink('tel:+989121234567'), { href: 'tel:+989121234567', newTab: false });
  assert.deepEqual(bookingLink('mailto:a@example.com'), { href: 'mailto:a@example.com', newTab: false });
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'http://example.com', null, undefined, '']) assert.equal(bookingLink(bad), null, String(bad));
});

test('checkBookingText: plain one-line text with a limit; empty is null; control characters are refused', () => {
  assert.deepEqual(checkBookingText('  رزرو   با   ما  ', 40), { ok: true, value: 'رزرو با ما' });
  assert.deepEqual(checkBookingText('', 40), { ok: true, value: null });
  assert.deepEqual(checkBookingText('   ', 40), { ok: true, value: null });
  assert.deepEqual(checkBookingText(null, 40), { ok: true, value: null });
  assert.deepEqual(checkBookingText('x'.repeat(40), 40).ok, true);
  assert.equal(checkBookingText('x'.repeat(41), 40).error, 'length');
  assert.equal(checkBookingText(5, 40).error, 'type');
  assert.equal(checkBookingText('a\u0000b', 40).error, 'format');
  assert.equal(checkBookingText('a\u202Ab', 40).ok, true, 'bidi marks are text (Persian needs them)');
  assert.equal(checkBookingText('a\u2028b', 40).error, 'format');
  assert.deepEqual(checkBookingText(SHORT, 40), { ok: true, value: SHORT }, 'markup characters are stored as text and escaped when rendered');
  assert.deepEqual([validateRoleLabel('  موسیقی جز و بلوز ').value, validateRoleLabel('x'.repeat(41)).error, validateRoleLabel(undefined).value], ['موسیقی جز و بلوز', 'length', null]);
  assert.deepEqual([BOOKING_LIMITS.url, BOOKING_LIMITS.label, BOOKING_LIMITS.note, DEFAULT_BOOKING_LABEL], [300, 40, 200, 'رزرو']);
});

// -------------------------------------------------------------------------------- the admin's own copy of the rules
function adminBookingCode() {
  const src = readFileSync(join(ROOT, 'deploy/admin-index.html'), 'utf8');
  const from = src.indexOf('const BOOKING_MODES');
  const to = src.indexOf('function bookingBlockHtml');
  assert.ok(from > 0 && to > from, 'the admin carries its booking checks');
  return new Function('state', `${src.slice(from, to)}\nreturn { BOOKING_MODES, bookingUrlProblem, BOOKING_MESSAGES, bookingFieldMessage };`)({ onlineBooking: null });
}

test('the admin editor checks a link exactly as the server does (same answers on every vector)', () => {
  const { bookingUrlProblem } = adminBookingCode();
  for (const [input, error] of URL_VECTORS) {
    if (typeof input !== 'string' || !input.trim()) continue; // the editor reads text fields: an empty one is "no link", the server's job to require it
    assert.equal(bookingUrlProblem(input), error || '', JSON.stringify(input));
  }
});

test('the admin editor words every booking error in Persian (client check and server 422 alike)', () => {
  const { BOOKING_MESSAGES, bookingFieldMessage, BOOKING_MODES } = adminBookingCode();
  const persian = /[\u0600-\u06FF]/;
  for (const [field, codes] of Object.entries({ bookingUrl: ['required', 'scheme', 'format', 'length', 'type'], bookingLabel: ['length', 'format', 'type'], bookingNote: ['length', 'format', 'type'], bookingMode: ['value'], roleLabel: ['length', 'format', 'type'] })) {
    for (const code of codes) {
      assert.ok(persian.test(BOOKING_MESSAGES[field][code]), `${field}.${code}`);
      assert.equal(bookingFieldMessage({ [field]: code }), BOOKING_MESSAGES[field][code]);
    }
  }
  assert.equal(bookingFieldMessage({ name: 'x' }), '');
  assert.deepEqual(BOOKING_MODES.map((m) => m[0]), ['online', 'external', 'none']);
  assert.ok(BOOKING_MODES.every(([, label]) => persian.test(label)));
  const html = readFileSync(join(ROOT, 'deploy/admin-index.html'), 'utf8');
  assert.match(html, /id="f_bookingMode"|id=\\?"f_bookingMode/, 'the mode select is in the tour editor');
  assert.ok(html.includes("['tehran', 'تهران']"), 'the region selects offer «تهران»');
  assert.equal((html.match(/\['tehran', 'تهران'\]/g) || []).length, 1, 'one REGIONS list feeds the tour and the host selects');
});

// ------------------------------------------------------------------------------------------ the admin API
let tourId;
let startsOn;
before(() => {
  db.seed();
  tourId = 'bm-tour';
  startsOn = future(2);
  db.createTour({ id: tourId, status: 'published', name: 'بزم نمونه', price: 1500000, duration: '۱ شب', galleryImages: [], galleryPhotos: [] });
  db.addTourDate(tourId, { label: 'اجرا', capacity: 30, startsOn });
});

test('admin API: mode, link, label and note are validated; the link is required for «external»; partial saves keep the rest', async () => {
  const put = (patch) => call('PUT', `/api/admin/tours/${tourId}`, patch);
  const read = async () => (await call('GET', `/api/admin/tours/${tourId}`)).data.tour;

  let t = await read();
  assert.deepEqual([t.bookingMode, t.bookingUrl, t.bookingLabel, t.bookingNote], ['online', null, 'رزرو', null], 'a tour starts as it always was');

  const bad = [
    [{ bookingMode: 'free' }, { bookingMode: 'value' }], [{ bookingMode: null }, { bookingMode: 'value' }], [{ bookingMode: 'EXTERNAL' }, { bookingMode: 'value' }],
    [{ bookingMode: 'external' }, { bookingUrl: 'required' }],                       // no link anywhere
    [{ bookingMode: 'external', bookingUrl: '' }, { bookingUrl: 'required' }],
    [{ bookingMode: 'external', bookingUrl: 'javascript:alert(1)' }, { bookingUrl: 'scheme' }],
    [{ bookingMode: 'external', bookingUrl: 'data:text/html,x' }, { bookingUrl: 'scheme' }],
    [{ bookingMode: 'external', bookingUrl: 'http://example.com/book' }, { bookingUrl: 'scheme' }],
    [{ bookingMode: 'external', bookingUrl: 'https://u:p@example.com' }, { bookingUrl: 'format' }],
    [{ bookingUrl: 'x'.repeat(301) }, { bookingUrl: 'length' }], [{ bookingUrl: 5 }, { bookingUrl: 'type' }],
    [{ bookingLabel: 'x'.repeat(41) }, { bookingLabel: 'length' }], [{ bookingLabel: 7 }, { bookingLabel: 'type' }],
    [{ bookingNote: 'x'.repeat(201) }, { bookingNote: 'length' }], [{ bookingNote: ['a'] }, { bookingNote: 'type' }], [{ bookingNote: 'a\u0000b' }, { bookingNote: 'format' }]
  ];
  for (const [patch, fields] of bad) {
    const r = await put(patch);
    assert.equal(r.status, 422, JSON.stringify(patch));
    assert.deepEqual(r.data.fields, fields, JSON.stringify(patch));
  }
  t = await read();
  assert.equal(t.bookingMode, 'online', 'nothing from a refused save was stored');

  const ok = await put({ bookingMode: 'external', bookingUrl: ' https://example.org/book?a=1&b=2 ', bookingLabel: ' رزرو   از ایتا ', bookingNote: ' ظرفیت محدود است ' });
  assert.equal(ok.status, 200);
  t = await read();
  assert.deepEqual([t.bookingMode, t.bookingUrl, t.bookingLabel, t.bookingNote], ['external', 'https://example.org/book?a=1&b=2', 'رزرو از ایتا', 'ظرفیت محدود است']);

  // a save that does not mention them keeps them; a save of another field with the mode «external» and the stored link is fine
  assert.equal((await put({ name: 'بزم نمونه ۲' })).status, 200);
  assert.equal((await put({ bookingNote: null })).status, 200);
  t = await read();
  assert.deepEqual([t.bookingMode, t.bookingUrl, t.bookingLabel, t.bookingNote, t.name], ['external', 'https://example.org/book?a=1&b=2', 'رزرو از ایتا', null, 'بزم نمونه ۲']);
  // clearing the link of an «external» tour is refused; switching the mode first makes it fine
  assert.equal((await put({ bookingUrl: null })).status, 422);
  assert.equal((await put({ bookingMode: 'none', bookingUrl: null })).status, 200);
  // tel: and mailto: are saved as they are
  assert.equal((await put({ bookingMode: 'external', bookingUrl: 'tel:+989121234567' })).status, 200);
  assert.equal((await read()).bookingUrl, 'tel:+989121234567');

  // creating a tour: «external» needs its link there too, and the defaults are the old behaviour
  assert.equal((await call('POST', '/api/admin/tours', { id: 'bm-new-a', name: 'الف', bookingMode: 'external' })).status, 422);
  assert.equal((await call('POST', '/api/admin/tours', { id: 'bm-new-b', name: 'ب', bookingMode: 'external', bookingUrl: 'https://example.org/x', bookingLabel: 'ثبت‌نام' })).status, 201);
  assert.equal((await call('POST', '/api/admin/tours', { id: 'bm-new-c', name: 'ج' })).status, 201);
  const c = (await call('GET', '/api/admin/tours/bm-new-c')).data.tour;
  assert.deepEqual([c.bookingMode, c.bookingUrl, c.bookingLabel], ['online', null, 'رزرو']);
  const list = (await call('GET', '/api/admin/tours')).data.tours;
  assert.ok(list.every((row) => ['online', 'external', 'none'].includes(row.booking_mode)));
  // the public JSON of a tour never carries the stored booking setup (the page model carries the effective one)
  assert.ok(!/bookingUrl|booking_url/.test((await get(`/api/tours/${tourId}`)).text));
  await call('DELETE', '/api/admin/tours/bm-new-a'); await call('DELETE', '/api/admin/tours/bm-new-b'); await call('DELETE', '/api/admin/tours/bm-new-c');
  assert.equal((await call('PUT', `/api/admin/tours/${tourId}`, { bookingMode: 'online', bookingUrl: null })).status, 200);
});

// ---------------------------------------------------------------------------------------------- the rendered pages
const setBooking = async (patch) => { const r = await call('PUT', `/api/admin/tours/${tourId}`, patch); assert.equal(r.status, 200, JSON.stringify(r.data)); };
const tourPage = async () => (await get(`/tour/${tourId}`)).text;
const SEAT_WORDS = ['جای خالی', 'ظرفیت هر اجرا', 'ظرفیت محدود', 'رزرو باز است'];

test('«external»: dates as information, the tour price, the note and ONE primary button to the link (https opens in a new tab with rel=noopener)', async () => {
  await setBooking({ bookingMode: 'external', bookingUrl: 'https://example.org/book?a=1&b=2', bookingLabel: 'رزرو از ایتا', bookingNote: 'برای هماهنگی پیام بدهید' });
  const page = await tourPage();
  const card = page.slice(page.indexOf('id="booking"'), page.indexOf('</aside>'));
  assert.ok(card.includes(formatCardDateFa(startsOn)) || card.includes('class="tp-ed tp-ed--info'), 'the edition is listed');
  assert.match(card, /<a class="ck-btn ck-btn--primary ck-btn--block tp-book__cta" href="https:\/\/example\.org\/book\?a=1&amp;b=2" target="_blank" rel="noopener" data-external-booking>رزرو از ایتا<\/a>/);
  assert.equal((card.match(/<a /g) || []).length, 1, 'one button');
  assert.ok(card.includes('۱٬۵۰۰٬۰۰۰'), 'the tour price');
  assert.ok(card.includes('برای هماهنگی پیام بدهید'), 'the note');
  assert.ok(!card.includes('<form') && !card.includes('<input') && !card.includes('<select') && !card.includes('<button'), 'no form control');
  assert.ok(!page.includes('data-booking') && !page.includes('پرداخت') && !page.includes('زرین‌پال') && !page.includes('رزرو این تجربه'));
  for (const w of SEAT_WORDS) assert.ok(!page.includes(w), `no seat wording: ${w}`);
  assert.ok(!page.includes('data-jump-booking'), 'the sticky bar does not jump to a form');
  // the mobile bar: price, the date, and the same button
  const sticky = page.slice(page.indexOf('data-sticky'), page.indexOf('</div>', page.indexOf('data-sticky') + 300) + 800);
  assert.match(sticky, /<a class="ck-btn ck-btn--primary" href="https:\/\/example\.org\/book\?a=1&amp;b=2" target="_blank" rel="noopener" data-external-booking>رزرو از ایتا<\/a>/);
  // the model the page is built from
  const model = JSON.parse((await get(`/api/pages/tour/${tourId}`)).text).page;
  assert.deepEqual([model.booking.mode, model.booking.effective, model.booking.soon, model.booking.link, model.booking.note],
    ['external', 'external', false, { href: 'https://example.org/book?a=1&b=2', newTab: true, label: 'رزرو از ایتا' }, 'برای هماهنگی پیام بدهید']);
  assert.deepEqual(model.editions.map((e) => [e.id, e.capacity, e.available, e.status, e.full, e.startsOn]), [[null, null, null, null, false, startsOn]]);
});

test('«external» with tel: and mailto: links: no new tab, no rel; with no label the button says «رزرو»; a bad stored link fails closed to «none»', async () => {
  await setBooking({ bookingMode: 'external', bookingUrl: 'tel:+989121234567', bookingLabel: null, bookingNote: null });
  let page = await tourPage();
  assert.match(page, /<a class="ck-btn ck-btn--primary ck-btn--block tp-book__cta" href="tel:\+989121234567" data-external-booking>رزرو<\/a>/);
  assert.match(page, /<a class="ck-btn ck-btn--primary" href="tel:\+989121234567" data-external-booking>رزرو<\/a>/);
  await setBooking({ bookingUrl: 'mailto:info@example.org?subject=Bazm' });
  page = await tourPage();
  assert.match(page, /href="mailto:info@example\.org\?subject=Bazm" data-external-booking>رزرو<\/a>/);
  assert.ok(!/target="_blank"[^>]*mailto|mailto[^>]*target="_blank"/.test(page));

  // a value that got into the database some other way (not through the admin) never becomes a link
  for (const evil of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://example.org', '//evil.example', 'https://u:p@example.org', 'https://a b']) {
    db.db.prepare('UPDATE tours SET booking_mode = ?, booking_url = ? WHERE id = ?').run('external', evil, tourId);
    page = await tourPage();
    assert.ok(!page.includes('data-external-booking'), `no button for ${evil}`);
    assert.ok(!page.includes('javascript:') && !page.includes('data:text') && !page.includes(evil.replace(/&/g, '&amp;')), `the stored value is not in the page: ${evil}`);
    assert.equal(JSON.parse((await get(`/api/pages/tour/${tourId}`)).text).page.booking.effective, 'none');
  }
  // the database itself refuses a mode that is not one of the three; the reader fails closed on one anyway
  assert.throws(() => db.db.prepare('UPDATE tours SET booking_mode = ? WHERE id = ?').run('no-such-mode', tourId), /CHECK constraint/);
  const { effectiveBooking } = await import('../server/booking.js');
  assert.deepEqual([effectiveBooking({ booking_mode: 'no-such-mode' }).effective, effectiveBooking({ booking_mode: 'no-such-mode' }).soon], ['none', false]);
  assert.equal(effectiveBooking({ booking_mode: 'external', booking_url: 'javascript:alert(1)' }).effective, 'none');
  assert.equal(effectiveBooking({ booking_mode: 'external', booking_url: 'https://example.org' }).effective, 'external');
  assert.equal(effectiveBooking({}).effective, 'none', 'online by default, and the switch is off in this suite');
  assert.equal(effectiveBooking({ booking_mode: 'online' }, { BOOKING_ONLINE_ENABLED: 'true' }).effective, 'online');
  assert.equal(effectiveBooking({ booking_mode: 'none' }, { BOOKING_ONLINE_ENABLED: 'true' }).effective, 'none');
});

test('«none»: dates and notes only, no button; an «online» tour with the switch off reads the same plus «رزرو آنلاین به‌زودی فعال می‌شود»', async () => {
  db.db.prepare("UPDATE tours SET booking_mode = 'none', booking_url = NULL WHERE id = ?").run(tourId);
  await setBooking({ bookingNote: 'ورود با دعوت‌نامه' });
  let page = await tourPage();
  assert.ok(page.includes('ورود با دعوت‌نامه') && page.includes('tp-ed--info'));
  assert.ok(!page.includes('<form') && !page.includes('data-external-booking') && !page.includes('data-booking') && !page.includes('رزرو آنلاین به‌زودی'));
  assert.ok(!/<a [^>]*tp-book__cta/.test(page));

  await setBooking({ bookingMode: 'online' });
  page = await tourPage();
  assert.ok(page.includes('رزرو آنلاین به‌زودی فعال می‌شود'));
  assert.ok(page.includes('ورود با دعوت‌نامه') && page.includes('tp-ed--info'));
  assert.ok(!page.includes('<form') && !page.includes('data-booking') && !page.includes('data-external-booking'));
  const sticky = page.slice(page.indexOf('data-sticky'));
  assert.ok(sticky.includes('رزرو آنلاین به‌زودی فعال می‌شود'), 'the mobile bar says it too');
  assert.ok(!/<a [^>]*class="ck-btn[^"]*"[^>]*data-sticky|data-jump-booking/.test(page), 'and offers no button');
  await setBooking({ bookingNote: null });
});

test('a dated future edition shows its date on the card and on the tour page in every mode: «جمعه ۱۷ مهر» style, no seat count unless the site books', async () => {
  const dated = formatCardDateFa(startsOn);
  assert.match(dated, /^[\u0600-\u06FF]+ [\u06F0-\u06F9]+ [\u0600-\u06FF]+$/, 'weekday, day, month');
  for (const [mode, extra, switchOn] of [['external', { bookingUrl: 'https://example.org/b' }, false], ['none', {}, false], ['online', {}, false], ['external', { bookingUrl: 'tel:+989121234567' }, true], ['none', {}, true], ['online', {}, true]]) {
    process.env.BOOKING_ONLINE_ENABLED = switchOn ? 'true' : 'false';
    try {
      await setBooking({ bookingMode: mode, ...extra });
      const siteBooks = mode === 'online' && switchOn;
      const label = `${mode}, switch ${switchOn ? 'on' : 'off'}`;
      for (const path of ['/', '/experiences']) {
        const text = (await get(path)).text;
        const at = text.indexOf(`href="/tour/${tourId}"`);
        const card = text.slice(at, text.indexOf('</a>', at));
        assert.ok(at > 0 && card.includes(dated), `${label}: the ${path} card shows ${dated}`);
        assert.equal(card.includes('جای خالی'), siteBooks && path === '/experiences', `${label}: ${path} card seat count`);
      }
      const page = await tourPage();
      assert.ok(mainOf(page).includes(formatDateRangeFa(startsOn, null)) || mainOf(page).match(/[\u06F0-\u06F9]+ [\u0600-\u06FF]+ ۱۴\d\d/), `${label}: the tour page lists the edition`);
      assert.equal(page.includes('جای خالی'), siteBooks, `${label}: tour page seat count`);
      assert.equal(page.includes('ظرفیت هر اجرا'), siteBooks, `${label}: tour page capacity`);
      assert.equal(page.includes('data-booking'), siteBooks, label);
    } finally { delete process.env.BOOKING_ONLINE_ENABLED; }
  }
  await setBooking({ bookingMode: 'online' });
});

test('a closed dated edition is listed as «تکمیل» (the admin closed it), also on the card; a closed undated one stays hidden', async () => {
  const closed = db.addTourDate(tourId, { label: 'بسته', capacity: 10, startsOn: future(5) });
  const hidden = db.addTourDate(tourId, { label: 'بدون تاریخ بسته', capacity: 10 });
  db.updateTourDate(closed.id, { closed: true });
  db.updateTourDate(hidden.id, { closed: true });
  await setBooking({ bookingMode: 'none' });
  const page = await tourPage();
  assert.ok(page.includes(formatCardDateFa(future(5))) || page.includes('تکمیل'));
  assert.equal((page.match(/tp-ed--full/g) || []).length, 1, 'only the dated closed edition');
  assert.ok(!page.includes('بدون تاریخ بسته'));
  // a tour whose only dated edition is closed still shows that date on its card, with «تکمیل»
  db.createTour({ id: 'bm-closed-only', status: 'published', name: 'بسته', price: 100 });
  const only = db.addTourDate('bm-closed-only', { label: 'x', capacity: 1, startsOn: future(7) });
  db.updateTourDate(only.id, { closed: true });
  const card = (await get('/experiences')).text;
  const at = card.indexOf('/tour/bm-closed-only');
  assert.ok(at > 0 && card.slice(at, at + 900).includes(`${formatCardDateFa(future(7))} · تکمیل`), 'the card says the date and «تکمیل»');
  const home = JSON.parse((await get('/api/pages/home')).text).page;
  assert.ok(!home.upcoming.some((c) => c.slug === 'bm-closed-only'), 'but the home «upcoming» row lists only editions that are open');
  await call('DELETE', '/api/admin/tours/bm-closed-only');
  await setBooking({ bookingMode: 'online' });
});

// ------------------------------------------------------------------------------------------------ the region
function contrast(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('region «تهران»: a fourth key, stamp class ck-stamp--city on the inverse tokens with contrast >= 4.5:1 in both themes', () => {
  assert.deepEqual(REGION_KEYS, ['desert', 'forest', 'sea', 'tehran']);
  assert.deepEqual(REGIONS.tehran, { label: 'تهران', tone: 'city' });
  assert.equal(REGIONS.desert.label, 'کویر');
  const css = readFileSync(join(ROOT, 'deploy/assets/chaacme.css'), 'utf8');
  assert.match(css, /\.ck-stamp--city \{ background: var\(--inverse\); color: var\(--on-inverse\); \}/);
  const block = (selector) => css.slice(css.indexOf(selector), css.indexOf('}', css.indexOf(selector)));
  for (const [theme, selector] of [['light', ':root, [data-theme="light"] {'], ['dark', '[data-theme="dark"] {']]) {
    const tokens = block(selector);
    const inverse = /--inverse:\s*(#[0-9a-f]{6})/i.exec(tokens)[1];
    const onInverse = /--on-inverse:\s*(#[0-9a-f]{6})/i.exec(tokens)[1];
    assert.ok(contrast(inverse, onInverse) >= 4.5, `${theme}: ${inverse} / ${onInverse} = ${contrast(inverse, onInverse).toFixed(1)}`);
  }
  assert.match(css, /\.ex-dot--city \{/);
  assert.match(css, /\.ck-photo--city \{/);
});

test('region «تهران»: the admin saves it for a tour and a place, the card and the page show the stamp, and the experiences filter offers it', async () => {
  assert.equal((await call('PUT', `/api/admin/tours/${tourId}`, { region: 'tehran' })).status, 200);
  assert.equal((await call('PUT', `/api/admin/tours/${tourId}`, { region: 'tehran-2' })).status, 422);
  for (const key of ['desert', 'forest', 'sea']) assert.equal((await call('PUT', `/api/admin/tours/${tourId}`, { region: key })).status, 200, key);
  await call('PUT', `/api/admin/tours/${tourId}`, { region: 'tehran' });
  const place = db.createHost({ slug: 'bm-place', kind: 'place', displayName: 'پشت‌بام', status: 'active', photoPath: null, bio: null, expertise: null, instagramHandle: null, contactPhone: null, userId: null });
  assert.equal((await call('PUT', `/api/admin/hosts/${place.id}`, { kind: 'place', displayName: 'پشت‌بام', regionKey: 'tehran' })).status, 200);
  assert.equal(db.getHostAdmin(place.id).regionKey, 'tehran');

  const page = await tourPage();
  assert.match(page, /<span class="ck-stamp ck-stamp--city">تهران<\/span>/);
  const exp = (await get('/experiences')).text;
  assert.match(exp, /ck-stamp ck-stamp--city ck-xcard__stamp">تهران</);
  assert.ok(exp.includes('class="ck-photo ck-photo--city"'), 'the empty frame is tinted for the city');
  // a second region exists in the catalogue, so the chips are offered
  db.createTour({ id: 'bm-forest', status: 'published', name: 'جنگل', region: 'forest' });
  const filtered = (await get('/experiences')).text;
  assert.match(filtered, /<input type="radio" name="region" value="tehran"><span class="ex-chip__in"><i class="ex-dot ex-dot--city" aria-hidden="true"><\/i>تهران<\/span>/);
  const only = (await get('/experiences?region=tehran')).text;
  assert.ok(only.includes('/tour/bm-tour') && !only.includes('/tour/bm-forest'));
  assert.equal(JSON.parse((await get('/api/pages/experiences?region=tehran')).text).page.count, 1);
  await call('DELETE', '/api/admin/tours/bm-forest');
  await call('PUT', `/api/admin/tours/${tourId}`, { region: null });
});

// -------------------------------------------------------------------------------------------- the role labels
test('role label per partner link: shown instead of the default role word, default otherwise, validated, ordered, many persons render as a grid', async () => {
  const people = [];
  for (let i = 1; i <= 7; i++) people.push(db.createHost({ slug: `bm-p${i}`, kind: 'person', displayName: `شخص ${i}`, status: 'active', photoPath: null, bio: null, expertise: `تخصص ${i}`, instagramHandle: null, contactPhone: null, userId: null }));
  const labels = ['موسیقی جز و بلوز', 'شام', 'نقاشی و پرفورمنس', 'طراحی و اجرای رویداد', null, '', `${SHORT}`];
  const entries = people.map((p, i) => ({ hostId: p.id, role: i === 0 ? 'lead' : 'co_host', roleLabel: labels[i] ?? undefined, sortOrder: i }));

  // validation
  for (const [bad, error] of [['x'.repeat(41), 'length'], [5, 'type'], ['a\u0000b', 'format'], [['a'], 'type']]) {
    const r = await call('PUT', `/api/admin/tours/${tourId}/hosts`, { hosts: entries.map((e, i) => (i === 3 ? { ...e, roleLabel: bad } : e)) });
    assert.deepEqual([r.status, r.data.fields], [422, { roleLabel: error }], JSON.stringify(bad));
  }
  assert.equal(db.tourHostsAdmin(tourId).length, 0, 'a refused save stored nothing');

  const saved = await call('PUT', `/api/admin/tours/${tourId}/hosts`, { hosts: entries });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.hosts.map((h) => h.roleLabel), ['موسیقی جز و بلوز', 'شام', 'نقاشی و پرفورمنس', 'طراحی و اجرای رویداد', null, null, SHORT]);
  assert.deepEqual((await call('GET', `/api/admin/tours/${tourId}/hosts`)).data.hosts.map((h) => h.roleLabel), saved.data.hosts.map((h) => h.roleLabel));

  const page = await tourPage();
  const block = page.slice(page.indexOf('class="tp-people"'), page.indexOf('</section>', page.indexOf('class="tp-people"')));
  assert.equal((block.match(/class="ck-pcard ck-pcard--person"/g) || []).length, 7, 'every person is a card');
  const roles = [...block.matchAll(/class="ck-pcard__role" style="display:block">([^<]*)</g)].map((m) => m[1]);
  assert.deepEqual(roles, ['موسیقی جز و بلوز', 'شام', 'نقاشی و پرفورمنس', 'طراحی و اجرای رویداد', 'هم‌برگزارکننده', 'هم‌برگزارکننده', ESC_SHORT], 'label when set, the default word otherwise, in the admin\'s order');
  assert.ok(!page.includes('<img src=x onerror'), 'the label is text');
  // the lead (default word «برگزارکننده») comes first even when it is not first in the list; the admin's order decides among the rest
  const reordered = [entries[3], entries[0], entries[2], entries[1]].map((e, i) => ({ ...e, sortOrder: i }));
  assert.equal((await call('PUT', `/api/admin/tours/${tourId}/hosts`, { hosts: reordered })).status, 200);
  const names = [...(await tourPage()).matchAll(/class="ck-pcard__name">(شخص \d)/g)].map((m) => m[1]);
  assert.deepEqual(names, ['شخص 1', 'شخص 4', 'شخص 3', 'شخص 2']);
  // a person with no label and the lead role says «برگزارکننده»
  assert.equal((await call('PUT', `/api/admin/tours/${tourId}/hosts`, { hosts: [{ hostId: people[0].id, role: 'lead', sortOrder: 0 }] })).status, 200);
  assert.ok((await tourPage()).includes('class="ck-pcard__role" style="display:block">برگزارکننده<'));
  // the layout: a grid on desktop, one column on a phone, long labels wrap instead of overflowing
  const css = readFileSync(join(ROOT, 'deploy/assets/chaacme.css'), 'utf8');
  assert.match(css, /\.tp-people \{ display: grid; grid-template-columns: repeat\(auto-fill, minmax\(260px, 1fr\)\)/);
  assert.match(css, /@media[^{]*\{[\s\S]*?\.tp-people \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /\.tp-people \.ck-pcard > span:last-child \{ min-width: 0; overflow-wrap: anywhere; \}/);
  await call('PUT', `/api/admin/tours/${tourId}/hosts`, { hosts: [] });
});

test('the role label does not leak into the venue card, and the public tour list carries it as plain text only', async () => {
  const id = (slug) => db.db.prepare('SELECT id FROM hosts WHERE slug = ?').get(slug).id;
  const rows = [{ hostId: id('bm-place'), role: 'venue', roleLabel: 'نباید دیده شود', sortOrder: 0 }, { hostId: id('bm-p1'), role: 'lead', roleLabel: 'میزبان', sortOrder: 1 }];
  const saved = await call('PUT', `/api/admin/tours/${tourId}/hosts`, { hosts: rows });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.data.hosts.map((h) => [h.role, h.roleLabel]), [['venue', null], ['lead', 'میزبان']], 'a venue has no label');
  assert.ok(!(await tourPage()).includes('نباید دیده شود'));
  await call('PUT', `/api/admin/tours/${tourId}/hosts`, { hosts: [] });
});

// ------------------------------------------------------------------------------------------------------- XSS
test('XSS in every new text field: escaped in the page and the model, never in the head (meta, OG, title)', async () => {
  const NOTE = '"><img src=x onerror=alert(1)></script><script>alert(2)</script>';
  const person = db.db.prepare('SELECT id FROM hosts WHERE slug = ?').get('bm-p2').id;
  await setBooking({ bookingMode: 'external', bookingUrl: 'https://example.org/book', bookingLabel: SHORT, bookingNote: NOTE });
  assert.equal((await call('PUT', `/api/admin/tours/${tourId}/hosts`, { hosts: [{ hostId: person, role: 'lead', roleLabel: SHORT, sortOrder: 0 }] })).status, 200);

  const page = await tourPage();
  assert.ok(!page.includes('<img src=x'), 'no raw <img>');
  assert.ok(!page.includes('<script>alert'), 'no raw <script>');
  assert.equal((page.match(/<script\b/g) || []).length, 3, 'only the import map, the shell script and the island script');
  for (const tag of page.match(/<[a-zA-Z][^>]*>/g) || []) assert.ok(!/\sonerror\s*=/i.test(tag.replace(/"[^"]*"/g, '""')), `a tag carrying onerror: ${tag.slice(0, 100)}`);
  const escNote = '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;&lt;/script&gt;&lt;script&gt;alert(2)&lt;/script&gt;';
  assert.ok(page.includes(`data-external-booking>${ESC_SHORT}</a>`), 'the button label, escaped');
  assert.ok(page.includes(escNote), 'the note, escaped');
  assert.ok(page.includes(`style="display:block">${ESC_SHORT}<`), 'the role label, escaped');
  const head = headOf(page);
  for (const needle of ['onerror', 'img src', 'alert(', ESC_SHORT, escNote]) assert.ok(!head.includes(needle), `the head carries none of the new fields (${needle})`);
  // the same text through the JSON model is JSON-escaped data, and the cards of the listing never carry the note or label
  const json = (await get(`/api/pages/tour/${tourId}`)).text;
  assert.equal(JSON.parse(json).page.booking.note, NOTE);
  const listing = (await get('/experiences')).text + (await get('/')).text;
  for (const needle of ['onerror', NOTE, ESC_SHORT, escNote]) assert.ok(!listing.includes(needle), `not on the cards: ${needle}`);
  // and through the admin's own markup: the editor writes every value with esc() (see test/admin-fixes.test.js for the generic rule)
  const adminHtml = readFileSync(join(ROOT, 'deploy/admin-index.html'), 'utf8');
  assert.ok(adminHtml.includes("esc(t.bookingUrl || '')") && adminHtml.includes('esc(a.roleLabel || \'\')'));
  await call('PUT', `/api/admin/tours/${tourId}/hosts`, { hosts: [] });
  await setBooking({ bookingMode: 'online', bookingUrl: null, bookingLabel: null, bookingNote: null });
});
