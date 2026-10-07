// Browser test for the Bazm release: the booking switch (OFF), the «external» / «none» reservation modes, the
// «تهران» stamp, role labels with many partners, and the admin editor's fields and Persian validation.
// Real app on a temp database, real Chromium, generated fixture images only. Screenshots go to E2E_OUT_DIR.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { boot, repo } from './harness.mjs';

const h = await boot({ name: 'booking-modes', env: { BOOKING_ONLINE_ENABLED: 'false' } });
const { db, O } = h;
const ok = (m) => console.log(`  ok  ${m}`);
db.seed();
h.adminAuth.upsertAdminUser('root', 'pw-pw-pw-pw-1');

const makeImage = h.fx.imageMaker(h.upload, join(h.dir, 'fx'));
const future = (d) => db.todayIso(new Date(Date.now() + d * 864e5));
const H = (v) => db.createHost({ photoPath: null, bio: null, expertise: null, instagramHandle: null, contactPhone: null, userId: null, status: 'active', ...v });

// ---- fixtures: an event in Tehran with seven partners, reserved elsewhere; a «none» tour; an online tour (switch off)
const names = ['موسیقی جز و بلوز', 'شام', 'نقاشی و پرفورمنس', 'طراحی و اجرای رویداد', 'DJ', 'عکاسی', 'یک عنوان نقش بسیار طولانی تا حد مجاز چهل'];
assert.equal(names[6].length, 40);
const people = [];
for (let i = 0; i < 7; i++) people.push(H({ slug: `bazm-p${i + 1}`, kind: 'person', displayName: i === 3 ? 'نامی بسیار بلند برای یک هنرمند که باید بدون بیرون‌زدگی بشکند' : `هنرمند ${i + 1}`, expertise: `تخصص ${i + 1}`, photoPath: i % 2 ? null : await makeImage({ hostSlug: `bazm-p${i + 1}` }, 600, 600) }));
const place = H({ slug: 'bazm-roof', kind: 'place', displayName: 'پشت‌بام نمونه', region: 'تهران، ونک', lodgingType: 'پشت‌بام', photoPath: await makeImage({ hostSlug: 'bazm-roof' }, 1600, 1000), regionKey: 'tehran' });
const mkTour = async (id, over) => {
  const g = [await makeImage({ tourId: id }), await makeImage({ tourId: id })];
  db.createTour({ id, status: 'published', name: over.name, price: over.price ?? 800000, duration: '۱ شب', region: over.region ?? null, story: 'شبی روی پشت‌بام، با موسیقی و شام.', galleryImages: ['الف', 'ب'], galleryPhotos: g, ...over.extra });
  db.addTourDate(id, { label: 'شب بزم', capacity: 40, startsOn: future(2) });
};
await mkTour('bazm-vol2', { name: 'بزم دوم', region: 'tehran', extra: { bookingMode: 'external', bookingUrl: 'https://example.org/bazm?src=site&x=1', bookingLabel: 'رزرو از طریق ایتا', bookingNote: 'ظرفیت محدود است؛ برای هماهنگی پیام بدهید.' } });
await mkTour('bazm-none', { name: 'شبی بدون رزرو', region: 'forest', extra: { bookingMode: 'none', bookingNote: 'ورود با دعوت‌نامه' } });
await mkTour('bazm-online', { name: 'تجربهٔ آنلاین', region: 'sea' });
db.setTourHosts('bazm-vol2', [{ hostId: place.id, role: 'venue', sortOrder: 0 }, ...people.map((p, i) => ({ hostId: p.id, role: i === 0 ? 'lead' : 'co_host', roleLabel: names[i], sortOrder: i + 1 }))]);

const contrast = (a, b) => {
  const L = (rgb) => { const [r, g, bl] = rgb.map((c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
  const [hi, lo] = [L(a), L(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const rgbOf = (s) => (/rgba?\((\d+), (\d+), (\d+)/.exec(s) || []).slice(1, 4).map(Number);

// ============================================================================ public pages
for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const ctx = await h.newCtx(viewport);
  const page = await h.newPage(ctx);

  // -- the «external» tour
  await page.goto(`${O}/tour/bazm-vol2`);
  const card = page.locator('#booking');
  assert.equal(await page.locator('form[data-booking], [data-booking]').count(), 0, 'no booking form');
  assert.equal(await page.locator('text=زرین‌پال').count(), 0, 'no payment sentence');
  const btn = card.locator('a[data-external-booking]');
  assert.equal(await btn.count(), 1);
  assert.deepEqual(await btn.evaluate((a) => [a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel'), a.textContent.trim()]),
    ['https://example.org/bazm?src=site&x=1', '_blank', 'noopener', 'رزرو از طریق ایتا']);
  assert.ok((await card.innerText()).includes('ظرفیت محدود است؛ برای هماهنگی پیام بدهید.'));
  assert.ok(!/جای خالی/.test(await page.locator('main').innerText()), 'no seat count');
  assert.ok((await card.locator('.tp-ed').first().innerText()).includes('۱۴۰'), 'the date of the edition is listed (Jalali year)');

  // -- partners: all seven, grid on desktop, stacked on a phone, nothing wider than its column
  const people = page.locator('.tp-people');
  assert.equal(await people.locator('.ck-pcard').count(), 7);
  const cols = await people.evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  assert.equal(cols, label === 'desktop' ? 2 : 1, `${label}: ${cols} column(s)`);
  const roleTexts = await people.locator('.ck-pcard__role').allInnerTexts();
  assert.deepEqual(roleTexts, names);
  const over = await people.evaluate((el) => { const r = el.getBoundingClientRect(); return [...el.querySelectorAll('.ck-pcard')].filter((c) => { const b = c.getBoundingClientRect(); return b.right > r.right + 1 || b.left < r.left - 1 || c.scrollWidth > c.clientWidth + 1; }).length; });
  assert.equal(over, 0, 'no card overflows the grid');
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${label}: no horizontal page scroll`);

  if (label === 'mobile') {
    const bar = page.locator('[data-sticky]');
    assert.equal(await bar.count(), 1);
    const sb = bar.locator('a[data-external-booking]');
    assert.equal(await sb.getAttribute('href'), 'https://example.org/bazm?src=site&x=1');
    assert.ok((await sb.boundingBox()).height >= 44, 'tap target');
    assert.equal(await page.locator('[data-jump-booking]').count(), 0);
  }
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await h.shot(page, `bazm-external-${label}-${theme}.png`);
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));

  // -- «none» and «online with the switch off»
  await page.goto(`${O}/tour/bazm-none`);
  assert.equal(await page.locator('#booking a, #booking button, #booking input, #booking form').count(), 0, 'none: no button');
  assert.ok((await page.locator('#booking').innerText()).includes('ورود با دعوت‌نامه'));
  assert.ok(!(await page.locator('#booking').innerText()).includes('به‌زودی فعال'));
  await h.shot(page, `bazm-none-${label}.png`);
  await page.goto(`${O}/tour/bazm-online`);
  assert.equal(await page.locator('[data-booking], #booking button, #booking input').count(), 0, 'online + switch off: no form');
  assert.ok((await page.locator('#booking').innerText()).includes('رزرو آنلاین به‌زودی فعال می‌شود'));
  if (label === 'mobile') assert.ok((await page.locator('[data-sticky]').innerText()).includes('رزرو آنلاین به‌زودی فعال می‌شود'));
  await h.shot(page, `bazm-online-off-${label}.png`);

  // -- the experiences list: the Tehran stamp, the date in «جمعه ۱۷ مهر» style, and the region filter
  await page.goto(`${O}/experiences`);
  const stamp = page.locator('.ck-stamp--city').first();
  assert.equal((await stamp.innerText()).trim(), 'تهران');
  for (const theme of ['light', 'dark']) {
    await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    const [fg, bg] = await stamp.evaluate((el) => [getComputedStyle(el).color, getComputedStyle(el).backgroundColor]);
    const c = contrast(rgbOf(fg), rgbOf(bg));
    assert.ok(c >= 4.5, `${label}/${theme}: the Tehran stamp contrast is ${c.toFixed(1)}`);
    await h.shot(page, `experiences-tehran-${label}-${theme}.png`);
  }
  await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  const cardText = await page.locator('a.ck-xcard[href="/tour/bazm-vol2"]').innerText();
  assert.match(cardText, /(شنبه|یکشنبه|دوشنبه|سه‌شنبه|چهارشنبه|پنجشنبه|جمعه) [۰-۹]+ [؀-ۿ]+/, 'weekday day month');
  assert.ok(!cardText.includes('جای خالی'), 'external: no seat count on the card');
  await page.locator('input[name="region"][value="tehran"]').check({ force: true }); // the island applies a filter change by itself
  await page.waitForURL(/region=tehran/);
  assert.equal(await page.locator('a.ck-xcard').count(), 1, 'the Tehran filter shows only the Tehran tour');
  await ctx.close();
}
ok('public pages: external button + note + dates (no seat count), none, online-off, Tehran stamp (AA both themes), 7 partners as grid/stack, no overflow');

// ============================================================================ an old booking, switch off
{
  const userId = Number(db.db.prepare("INSERT INTO users (phone, first_name, last_name, username) VALUES ('09120009911', 'ا', 'ب', 'bm_user')").run().lastInsertRowid);
  const dateId = db.getTourDetail('bazm-online').bookingDates[0].id;
  const old = db.createBooking({ userId, tourId: 'bazm-online', tourDateId: dateId, guests: 2 });
  const ctx = await h.newCtx({ width: 390, height: 844 });
  await ctx.addCookies([{ name: 'chaacme_session', value: h.auth.createSession(userId), url: O }]);
  const page = await h.newPage(ctx);
  await page.goto(`${O}/booking/result?ref=${old.ref}`);
  await page.waitForSelector('.br-card h1');
  const text = await page.locator('.br-card').innerText();
  assert.ok(text.includes(old.ref) && text.includes('تجربهٔ آنلاین'), 'the old booking is still shown');
  assert.ok(text.includes('رزرو آنلاین فعلاً فعال نیست'), 'and says online booking is off');
  assert.equal(await page.locator('.br-card a', { hasText: 'تلاش دوباره' }).count(), 0, 'no "try again"');
  await h.shot(page, 'booking-result-switch-off.png');
  await page.goto(`${O}/account`);
  await page.waitForSelector('.ac-trip');
  assert.ok((await page.locator('.ac-trip').first().innerText()).includes(old.ref), 'the account page lists it');
  await ctx.close();
  ok('an old pending booking: /booking/result and /account still work with the switch off, and offer no way to pay');
}

// ============================================================================ the admin editor
const adminHtml = readFileSync(`${repo}/deploy/admin-index.html`, 'utf8');
const ctx = await h.newCtx({ width: 1300, height: 1000 });
await ctx.route((u) => u.origin === O && /^\/admin\/?$/.test(u.pathname), (r) => r.fulfill({ contentType: 'text/html; charset=utf-8', body: adminHtml }));
const page = await h.newPage(ctx);
const writes = [];
page.on('request', (r) => { if (['PUT', 'POST'].includes(r.method()) && r.url().includes('/api/admin/tours')) writes.push(`${r.method()} ${new URL(r.url()).pathname}`); });
await page.goto(`${O}/admin`);
assert.equal(await page.evaluate(async () => (await fetch('/api/admin/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'root', password: 'pw-pw-pw-pw-1' }) })).status), 200);
await page.goto(`${O}/admin#/tours/bazm-none/edit`);
await page.reload();
await page.waitForSelector('#f_bookingMode');

// the editor shows what is stored, and the region select offers Tehran
assert.equal(await page.inputValue('#f_bookingMode'), 'none');
assert.ok((await page.locator('#f_region option').allInnerTexts()).includes('تهران'));
assert.equal(await page.locator('#bookingExtBox').isHidden(), true, 'the link box is only for «external»');
assert.match(await page.locator('#bookingModeHint').innerText(), /فقط تاریخ‌ها و یادداشت/);
await page.selectOption('#f_bookingMode', 'online');
assert.match(await page.locator('#bookingModeHint').innerText(), /فعلاً خاموش است/, 'says the site-wide switch is off');
await page.selectOption('#f_bookingMode', 'external');
assert.equal(await page.locator('#bookingExtBox').isVisible(), true);
assert.equal(await page.getAttribute('#f_bookingUrl', 'maxlength'), '300');
assert.equal(await page.getAttribute('#f_bookingLabel', 'maxlength'), '40');
assert.equal(await page.getAttribute('#f_bookingNote', 'maxlength'), '200');

// Persian validation, and nothing is sent while the link is wrong
const tryUrl = async (url, expected) => {
  await page.fill('#f_bookingUrl', url);
  const before = writes.length;
  await page.click('#saveBtn');
  await page.waitForFunction((e) => document.getElementById('bookingMsg').textContent.includes(e), expected);
  assert.equal(writes.length, before, `nothing was sent for ${JSON.stringify(url)}`);
  assert.ok(/[؀-ۿ]/.test(await page.locator('#bookingMsg').innerText()));
};
await tryUrl('', 'لینک رزرو لازم است');
await tryUrl('javascript:alert(1)', 'فقط می‌تواند با https');
await tryUrl('data:text/html,hello', 'فقط می‌تواند با https');
await tryUrl('http://example.org/book', 'فقط می‌تواند با https');
await tryUrl('https://exa mple.org', 'لینک رزرو معتبر نیست');
await tryUrl('https://user:pw@example.org', 'لینک رزرو معتبر نیست');
await h.shot(page, 'admin-booking-error.png');
// the field itself holds at most 300 characters, so a longer link cannot even be typed
await page.fill('#f_bookingUrl', `https://example.org/${'a'.repeat(400)}`);
assert.equal((await page.inputValue('#f_bookingUrl')).length, 300);

// a valid link saves, and the stored tour and the public page follow
await page.fill('#f_bookingUrl', 'tel:+989121234567');
await page.fill('#f_bookingLabel', 'تماس برای رزرو');
await page.fill('#f_bookingNote', 'ساعت تماس ۱۰ تا ۱۸');
await page.click('#saveBtn');
await page.waitForFunction(() => /ذخیره شد/.test(document.querySelector('#toast, .toast')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(500);
let t = db.getTourDetailAdmin('bazm-none');
assert.deepEqual([t.bookingMode, t.bookingUrl, t.bookingLabel, t.bookingNote], ['external', 'tel:+989121234567', 'تماس برای رزرو', 'ساعت تماس ۱۰ تا ۱۸']);
assert.match(await (await fetch(`${O}/tour/bazm-none`)).text(), /href="tel:\+989121234567" data-external-booking>تماس برای رزرو<\/a>/);
await page.waitForSelector('#f_bookingMode');
assert.equal(await page.inputValue('#f_bookingUrl'), 'tel:+989121234567', 'reloaded with the saved link');

// back to «none» through the editor
await page.selectOption('#f_bookingMode', 'none');
await page.click('#saveBtn');
await page.waitForTimeout(800);
assert.equal(db.getTourDetailAdmin('bazm-none').bookingMode, 'none');
ok('admin editor: mode/link/label/note, link box only for external, Persian validation without a request, saved and live');

// partners: a role label per link, in the admin's order
await page.goto(`${O}/admin#/tours/bazm-vol2/edit`);
await page.reload();
await page.waitForSelector('#tourHostsPanel .th-row');
const labels = page.locator('#tourHostsPanel .th-label');
assert.equal(await labels.count(), 7);
assert.equal(await labels.nth(0).inputValue(), names[0]);
assert.equal(await labels.nth(0).getAttribute('maxlength'), '40');
await labels.nth(1).fill('شام و دسر');
await page.locator('#tourHostsPanel .th-down').nth(1).click();          // move the 2nd person down one place
await page.waitForSelector('#tourHostsPanel .th-label');
await h.shot(page, 'admin-partners-labels.png');
await page.click('#thSave');
await page.waitForTimeout(800);
const saved = db.tourHostsAdmin('bazm-vol2').filter((r) => r.role !== 'venue');
assert.equal(saved.length, 7);
assert.deepEqual(saved.slice(0, 3).map((r) => r.roleLabel), [names[0], names[2], 'شام و دسر'], 'label typed + order changed in the admin');
assert.match(await (await fetch(`${O}/tour/bazm-vol2`)).text(), /ck-pcard__role" style="display:block">شام و دسر</);
ok('admin editor: role label per partner link (maxlength 40), reorder, saved, shown on the page');

await page.goto(`${O}/admin#/tours/bazm-vol2/edit`);
await page.reload();
await page.waitForSelector('#f_bookingMode');
await page.locator('#sec-5').scrollIntoViewIfNeeded();
await h.shot(page, 'admin-booking-section-external.png');

assert.deepEqual(h.errors, [], 'no page errors');
await ctx.close();
await h.close();
console.log(`E2E OK -> ${h.outDir}`);
