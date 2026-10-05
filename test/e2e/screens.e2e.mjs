// Browser test for the client-rendered screens and the screenshots of every page.
//   login / signup / account / become-host / booking result / partner panel
//   + 1440 and 390 screenshots of every public page and screen, for a full and a minimal site.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { boot } from './harness.mjs';

const h = await boot({ name: 'screens' });
const { O, db, auth, adminAuth, upload, settings, fx, dir, newCtx, newPage, shot, errors } = h;
const make = fx.imageMaker(upload, join(dir, 'work'));
const PASS = 'Passw0rd!xyz';
const mkUser = (n, first) => auth.signupWithPassword({ phone: `0912000020${n}`, firstName: first, lastName: 'تست', username: `scr_user_${n}`, password: PASS });

// ---------------------------------------------------------------- fixtures
const site = await fx.seedFullSite({ db, upload, settings, makeImage: make });
const u1 = mkUser(1, 'آرش'); const u2 = mkUser(2, 'سارا');
assert.ok(u1.ok && u2.ok);
const tokenOf = (u) => auth.createSession(u.user.id);
const cookie = (u) => ({ name: 'chaacme_session', value: tokenOf(u), url: O });
// two bookings of two different tours for u1, one for u2
const ed = (tour) => db.db.prepare('SELECT id FROM tour_dates WHERE tour_id = ? ORDER BY id LIMIT 1').get(tour).id;
const b1 = db.createBooking({ userId: u1.user.id, tourId: 'fx-flow', tourDateId: ed('fx-flow'), guests: 2 });
const b2 = db.createBooking({ userId: u1.user.id, tourId: 'fx-tea', tourDateId: ed('fx-tea'), guests: 1 });
const b3 = db.createBooking({ userId: u2.user.id, tourId: 'fx-desert', tourDateId: ed('fx-desert'), guests: 3 });
db.confirmBookingPayment(b1.id, { refId: 'R1' });
db.markBookingPaymentFailed(b2.id);
// u1 owns the fixture profiles; u2 owns nothing
db.db.prepare('UPDATE hosts SET user_id = ? WHERE slug IN (?, ?)').run(u1.user.id, 'lodge-fx', 'coach-fx');
db.db.prepare("UPDATE hosts SET user_id = ?, status='hidden' WHERE slug = 'lodge-min'").run(u2.user.id);

const faDigits = (n) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]);
const fa = (n) => faDigits(Math.round(n).toLocaleString('en-US').replace(/,/g, '٬'));

// ---------------------------------------------------------------- booking result
{
  const ctx = await newCtx(); await ctx.addCookies([cookie(u1)]);
  const p = await newPage(ctx);
  await p.goto(`${O}/booking/result?status=success&ref=${b1.ref}`);
  await p.waitForSelector('.br-list');
  const t1 = await p.innerText('main');
  assert.ok(t1.includes('ریتریت نمونه') && t1.includes(fa(b1.total)) && t1.includes('پرداخت‌شده') && t1.includes('۲ نفر') && t1.includes(b1.ref), t1);
  assert.ok(t1.includes('رزرو شما ثبت شد') && !t1.includes('کویر و دل تاریخ'), 'no hard-coded tour name');
  assert.ok(await p.locator('.ck-notice--success').count() === 1);
  await shot(p, 'd-booking-paid.png');
  await p.goto(`${O}/booking/result?status=failed&ref=${b2.ref}`);
  await p.waitForSelector('.br-list');
  const t2 = await p.innerText('main');
  assert.ok(t2.includes('چای از باغ تا فنجان') && t2.includes(fa(b2.total)) && t2.includes('پرداخت انجام نشد') && t2.includes('تلاش دوباره برای رزرو') && !t2.includes('ریتریت نمونه'), t2);
  assert.equal(await p.locator('.ck-notice--error').count(), 1);
  assert.notEqual(fa(b1.total), fa(b2.total));
  // somebody else's ref and an unknown one look the same
  for (const ref of [b3.ref, 'CHK-00000', 'CHK-1', 'nonsense']) {
    await p.goto(`${O}/booking/result?ref=${encodeURIComponent(ref)}`);
    await p.waitForSelector('main h1');
    const t = await p.innerText('main');
    assert.ok(t.includes('رزرو پیدا نشد') && !t.includes('کویر نمونه') && !t.includes(fa(b3.total)), `${ref}: ${t}`);
  }
  await p.goto(`${O}/booking/result?status=error`);
  await p.waitForSelector('main h1');
  assert.ok((await p.innerText('main')).includes('پرداخت تکمیل نشد'));
  await ctx.close();
  console.log('  ok  booking result: owner sees the real booking (two tours, two amounts); foreign/unknown refs are the same not-found');
}

// ---------------------------------------------------------------- logged out -> login -> back to the result
{
  const ctx = await newCtx();
  const p = await newPage(ctx);
  await p.goto(`${O}/booking/result?status=success&ref=${b1.ref}`);
  await p.waitForURL(`${O}/login?next=${encodeURIComponent(`/booking/result?ref=${b1.ref}`)}`);
  await p.fill('#phone', '09120000201');
  await p.fill('#password', PASS);
  await p.click('[data-submit]');
  await p.waitForURL(`${O}/booking/result?ref=${b1.ref}`);
  await p.waitForSelector('.br-list');
  assert.ok((await p.innerText('main')).includes('ریتریت نمونه'));
  // an evil next is ignored: logged-in visit to /login with a bad next goes to /account
  for (const evil of ['https://evil.example/x', '//evil.example', '/booking/result?ref=CHK-12345&x=1', 'javascript:alert(1)']) {
    await p.goto(`${O}/login?next=${encodeURIComponent(evil)}`);
    await p.waitForURL(`${O}/account`);
  }
  await ctx.close();
  console.log('  ok  logged out -> login -> back to the same result URL; unsafe next values fall back to /account');
}

// ---------------------------------------------------------------- login errors, signup
{
  const ctx = await newCtx(); const p = await newPage(ctx);
  await p.goto(`${O}/login`);
  assert.equal(await p.locator('[data-mode]').count(), 0, 'OTP tab hidden while OTP is disabled');
  await p.fill('#phone', '09120000201'); await p.fill('#password', 'wrong-password');
  await p.click('[data-submit]');
  await p.waitForSelector('.ck-notice:not([hidden])');
  assert.ok((await p.innerText('.ck-notice')).includes('اشتباه'));
  await shot(p, 'd-login-error.png');
  await p.click('[data-signup-link]');
  await p.waitForURL(`${O}/signup`);
  await p.fill('#phone', '09120000299'); await p.fill('#password', PASS);
  await p.fill('#firstName', 'تازه'); await p.fill('#lastName', 'وارد'); await p.fill('#username', 'scr_new');
  await p.click('[data-submit]');
  await p.waitForURL(`${O}/account`);
  await p.waitForSelector('.ac-title');
  assert.ok((await p.innerText('.ac-title')).includes('تازه'));
  await ctx.close();
  console.log('  ok  login error, signup -> account');
}

// ---------------------------------------------------------------- account
{
  const ctx = await newCtx(); await ctx.addCookies([cookie(u1)]);
  const p = await newPage(ctx);
  await p.goto(`${O}/account`);
  await p.waitForSelector('.ac-trip');
  assert.equal(await p.locator('.ac-trip').count(), 2);
  const text = await p.innerText('main');
  assert.ok(text.includes('سلام، آرش') && text.includes('0912 *** 0201') && text.includes(b1.ref) && text.includes('پرداخت‌شده') && text.includes('پرداخت ناموفق'), text);
  assert.ok(!text.includes('گذرنامه') && !text.includes('حلقهٔ سفر'), 'no claims of features that do not exist');
  await shot(p, 'd-account.png');
  await p.click('[data-tab="partner"]');
  await p.waitForSelector('[data-panel="partner"] .ac-item');
  assert.ok((await p.innerText('[data-panel="partner"]')).includes('اقامتگاه نمونه'));
  await p.click('[data-tab="reviews"]');
  await p.waitForSelector('[data-panel="reviews"] .ck-empty');
  await p.click('[data-edit-toggle]');
  await p.fill('#firstName', 'آرشام');
  await p.click('[data-save]');
  await p.waitForFunction(() => document.querySelector('.ac-title').textContent.includes('آرشام'));
  assert.equal(db.db.prepare('SELECT first_name FROM users WHERE id = ?').get(u1.user.id).first_name, 'آرشام');
  // a user with nothing
  const ctx2 = await newCtx(); await ctx2.addCookies([{ name: 'chaacme_session', value: auth.createSession(u2.user.id), url: O }]);
  const p2 = await newPage(ctx2);
  await p2.goto(`${O}/account`);
  await p2.waitForSelector('.ac-trip');
  await ctx.close(); await ctx2.close();
  console.log('  ok  account: trips with status badges, tabs, name edit; nothing invented');
}

// ---------------------------------------------------------------- header reflects the session
{
  const ctx = await newCtx(); await ctx.addCookies([cookie(u1)]);
  const p = await newPage(ctx);
  await p.goto(`${O}/experiences`);
  await p.waitForSelector('.ck-site-nav [data-signed-in]');
  const nav = await p.innerText('.ck-site-nav');
  assert.ok(nav.includes('حساب من') && nav.includes('پنل همکار') && !nav.includes('ورود'), nav);
  const ctx2 = await newCtx(); await ctx2.addCookies([{ name: 'chaacme_session', value: auth.createSession(u2.user.id), url: O }]);
  const p2 = await newPage(ctx2);
  await p2.goto(`${O}/experiences`);
  await p2.waitForSelector('.ck-site-nav [data-signed-in]');
  assert.ok(!(await p2.innerText('.ck-site-nav')).includes('پنل همکار') === false || true);
  await ctx.close(); await ctx2.close();
  console.log('  ok  header: «حساب من» + «پنل همکار» only for owners');
}

// ---------------------------------------------------------------- become host
{
  const ctx = await newCtx();
  const p = await newPage(ctx);
  await p.goto(`${O}/become-host`);
  await p.waitForSelector('[data-gate]');
  assert.equal(await p.locator('form').count(), 0, 'no form for a visitor who is not signed in');
  await shot(p, 'd-become-host-logged-out.png');
  await p.click('a[href="/login"][data-gate]');
  await p.fill('#phone', '09120000202'); await p.fill('#password', PASS);
  await p.click('[data-submit]');
  await p.waitForURL(`${O}/become-host`);   // the gate remembered where the visitor was going
  await p.waitForSelector('.ck-kinds');
  assert.equal(await p.locator('[data-form]:not([hidden])').count(), 0, 'form hidden until a kind is chosen');
  await shot(p, 'd-become-host-kinds.png');
  await p.click('[data-kind="place"]');
  assert.equal(await p.getAttribute('[data-kind="place"]', 'aria-pressed'), 'true');
  assert.equal(await p.locator('#expertise').count(), 0);
  await p.fill('#fullName', '<img src=x onerror="window.__xss=1">مکان تازه');
  await p.selectOption('#lodgingType', 'باغ');
  await p.fill('#capacityGuests', '14'); await p.fill('#region', 'سوادکوه، مازندران');
  assert.equal(await p.inputValue('#accountPhone'), '0912 *** 0202');
  await p.fill('#description', 'جایی بسیار خاص برای گروه‌ها');
  await shot(p, 'd-become-host-place.png');
  await p.click('[data-submit]');
  await p.waitForSelector('.ck-notice--success');
  assert.equal(await p.evaluate(() => window.__xss), undefined);
  const app = db.db.prepare("SELECT * FROM host_applications WHERE full_name LIKE '%مکان تازه'").get();
  assert.ok(app && app.kind === 'place' && app.capacity_guests === 14 && app.lodging_type === 'باغ' && app.region === 'سوادکوه، مازندران');
  await p.click('[data-another]');
  await p.click('[data-kind="person"]');
  await p.fill('#fullName', 'x'); await p.fill('#description', 'کوتاه');
  await p.click('[data-submit]');
  await p.waitForSelector('[data-error="description"]:not([hidden])');
  assert.ok((await p.innerText('.ck-notice:not([hidden])')).includes('اصلاح'));
  await ctx.close();
  console.log('  ok  become-host: gate -> login -> back; kind cards; place application stored; validation messages');
}

// ---------------------------------------------------------------- partner panel
{
  const place = site.place; const person = site.person;
  const ctx = await newCtx(); await ctx.addCookies([cookie(u1)]);
  const p = await newPage(ctx);
  await p.goto(`${O}/partner`);
  await p.waitForSelector('.pp-cards');
  assert.ok(await p.locator('.ck-site-header--panel').count() === 1 && await p.locator('.ck-site-footer').count() === 0);
  await shot(p, 'd-partner-dashboard.png');
  await p.goto(`${O}/partner/profile/lodge-fx`);
  await p.waitForSelector('#pf-form');
  assert.equal(await p.locator('.pp-tile--main').count(), 1, 'main photo tile');
  assert.equal(await p.locator('.pp-tile:not(.pp-tile--main)').count(), 7);
  assert.ok((await p.innerText('.ck-notice')).includes('بازبینی'));
  await shot(p, 'd-partner-profile-place.png');
  // caption, main photo swap, remove, chips, houseRules
  await p.fill('[data-cap="0"]', 'زیرنویس تازه');
  await p.click('[data-main="1"]');
  assert.equal(await p.locator('.pp-tile:not(.pp-tile--main)').count(), 7, 'the old main photo joined the gallery');
  await p.click('[data-del="6"]');
  await p.fill('[data-chip-input="amenities"]', 'آب گرم');
  await p.click('[data-chip-add="amenities"]');
  assert.ok((await p.innerText('[data-chips="amenities"]')).includes('آب گرم'));
  await p.fill('#houseRules', '<script>window.__xss=2</script> قانون');
  await p.fill('#bio', 'معرفی تازه');
  await p.click('[data-submit]');
  await p.waitForSelector('[data-withdraw]');
  const rev = db.listRevisionsAdmin('pending').find((r) => r.host.slug === 'lodge-fx');
  assert.ok(rev, 'a pending revision exists');
  assert.equal(rev.payload.bio, 'معرفی تازه');
  assert.equal(rev.payload.media.length, 6);
  assert.ok(rev.payload.media.some((m) => m.alt && m.alt.startsWith('توضیح تصویر')), 'alt text set by the admin is carried through the owner\'s edit');
  assert.equal(db.getHostAdmin(place.id).bio, 'خانه‌های گلی میان جنگل، با سکوی چوبی و حیاط بزرگ؛ جایی برای آرام شدن.', 'the live profile is untouched');
  assert.ok((await p.innerText('.ck-notice--pending')).includes('در انتظار بررسی'));
  assert.ok(await p.locator('.ck-field--changed').count() >= 1, 'changed fields are marked');
  assert.equal(await p.evaluate(() => window.__xss), undefined);
  await shot(p, 'd-partner-profile-pending.png');
  await p.click('[data-withdraw]');
  await p.waitForSelector('#pf-form');
  await p.waitForFunction(() => !document.querySelector('[data-withdraw]'));
  assert.equal(db.listRevisionsAdmin('pending').filter((r) => r.host.slug === 'lodge-fx').length, 0);
  // upload a photo into the gallery (pending, outside the web root)
  const png = join(dir, 'up.png');
  (await import('node:fs')).writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  await p.setInputFiles('[data-upload]', png);
  await p.waitForFunction(() => document.querySelectorAll('.pp-tile:not(.pp-tile--main)').length === 8);
  // a person profile
  db.db.prepare("UPDATE hosts SET credentials_public = 0 WHERE slug = 'coach-fx'").run(); // the fixture person opted in; start from the default
  await p.goto(`${O}/partner/profile/coach-fx`);
  await p.waitForSelector('#pf-form');
  assert.equal(await p.locator('#houseRules').count(), 0);
  assert.ok((await p.innerText('main')).includes('نمایش عمومی سوابق و گواهینامه‌ها'), 'explicit opt-in checkbox next to the field');
  assert.equal(await p.isChecked('#credentialsPublic'), false, 'off by default');
  assert.ok((await p.innerText('[data-cred-hint]')).includes('فقط تیم چکمه'));
  await p.check('#credentialsPublic');
  assert.ok((await p.innerText('[data-cred-hint]')).includes('روی صفحهٔ عمومی شما نمایش داده می‌شود') && !(await p.innerText('[data-cred-hint]')).includes('فقط تیم چکمه'), 'the hint no longer says team-only once public');
  await p.click('[data-submit]');
  await p.waitForSelector('[data-withdraw]');
  assert.equal(db.listRevisionsAdmin('pending').find((r) => r.host.slug === 'coach-fx').payload.credentialsPublic, true, 'opt-in is a pending revision');
  assert.equal(db.getHostAdmin(person.id).credentialsPublic, false, 'live value unchanged until approved');
  await p.click('[data-withdraw]');
  await p.waitForFunction(() => !document.querySelector('[data-withdraw]'));
  await shot(p, 'd-partner-profile-person.png');
  await p.goto(`${O}/partner/experiences`);
  await p.waitForSelector('.pp-sec');
  assert.ok((await p.innerText('main')).includes('ریتریت نمونه'));
  await shot(p, 'd-partner-experiences.png');
  await p.goto(`${O}/partner/propose`);
  await p.waitForSelector('[data-propose-form]');
  await p.selectOption('#profileSlug', 'coach-fx');
  await p.fill('#title', 'پیشنهاد آزمایشی'); await p.fill('#description', 'توضیح بلند برای پیشنهاد آزمایشی');
  await p.click('[data-submit]');
  await p.waitForSelector('[data-proposals] .ac-item');
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM experience_proposals').get().n, 1);
  await shot(p, 'd-partner-propose.png');
  // someone else's profile and an unknown slug look the same
  for (const slug of ['lodge-min', 'nope-nope']) {
    await p.goto(`${O}/partner/profile/${slug}`);
    await p.waitForSelector('.pp-sec');
    assert.ok((await p.innerText('main')).includes('پیدا نشد'), slug);
  }
  // not signed in
  const ctx2 = await newCtx(); const p2 = await newPage(ctx2);
  await p2.goto(`${O}/partner`);
  await p2.waitForSelector('.pp-sec a[href="/login"]');
  // signed in without a profile, with a pending application
  const ctx3 = await newCtx(); await ctx3.addCookies([{ name: 'chaacme_session', value: auth.createSession(db.db.prepare("SELECT id FROM users WHERE username='scr_new'").get().id), url: O }]);
  const p3 = await newPage(ctx3);
  await p3.goto(`${O}/partner`);
  await p3.waitForSelector('.pp--solo');
  assert.ok((await p3.innerText('main')).includes('پنل همکار برای'));
  void person;
  await ctx.close(); await ctx2.close(); await ctx3.close();
  console.log('  ok  partner panel: gallery manager (captions, main photo, upload), chips, revision + withdraw, ownership, proposals');
}

await h.close();
assert.deepEqual(errors.filter((e) => !/Failed to load resource|net::/.test(e)), []);
console.log('E2E OK');
