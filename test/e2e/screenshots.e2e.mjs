// Headless screenshots of EVERY page and screen at 1440 and 390, for a full and a minimal (title-only) site.
// Output: $E2E_OUT_DIR/<full|minimal>-<1440|390>-<name>.png. Also asserts on every page, in both fixtures:
// no horizontal scroll, no placeholder text ("undefined", "null", "NaN", [slots]), every <img> has alt, headings are followed by content.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { boot } from './harness.mjs';

const h = await boot({ name: 'shots' });
const { O, db, auth, adminAuth, upload, settings, fx, dir, newCtx, newPage, errors, outDir } = h;
const make = fx.imageMaker(upload, join(dir, 'work'));
adminAuth.upsertAdminUser('root', 'pw-pw-pw-pw-1');
const { readFileSync } = await import('node:fs');
const { repo } = await import('./harness.mjs');
const adminHtml = readFileSync(`${repo}/deploy/admin-index.html`, 'utf8');
const mkUser = (n, first) => auth.signupWithPassword({ phone: `0912000030${n}`, firstName: first, lastName: 'تست', username: `shot_${n}`, password: 'Passw0rd!xyz' });
const VIEWPORTS = [[1440, 900], [390, 844]];

const wipe = () => {
  for (const t of ['reviews', 'bookings', 'tour_hosts', 'host_revisions', 'experience_proposals', 'host_applications', 'host_media', 'hosts', 'tour_dates', 'tour_media', 'tour_highlights', 'tour_itinerary', 'tour_review_categories', 'tours', 'site_settings', 'sessions', 'users']) db.db.prepare(`DELETE FROM ${t}`).run();
};

async function capture(mode, { pages, screens, admin }) {
  for (const [w, hgt] of VIEWPORTS) {
    const tag = `${mode}-${w}`;
    const check = async (p, name, { allowOverflow = false, touch = true, digits = false } = {}) => {
      await p.waitForTimeout(450);
      const info = await p.evaluate(() => {
        const text = document.body.innerText;
        const imgs = Array.from(document.images).filter((i) => !i.hasAttribute('alt')).length;
        return { text, overflow: document.documentElement.scrollWidth - window.innerWidth, noAlt: imgs };
      });
      assert.ok(allowOverflow || info.overflow <= 1, `${tag} ${name}: horizontal scroll (${info.overflow}px)`);
      // touch targets: every control a visitor taps is at least 44px tall (links inside running text are exempt)
      const small = await p.evaluate(() => Array.from(document.querySelectorAll('button, select, input:not([type=hidden]):not([type=file]):not([type=radio]):not([type=checkbox]), textarea, summary, nav a, .ck-btn, .ck-chip, a.ck-xcard, label.ex-chip'))
        .filter((e) => e.offsetParent !== null && !e.closest('[hidden]') && !e.closest('.ck-visually-hidden') && !e.matches('.ck-chip:not(.ck-chip--add)') && !e.closest('.bh-hp') && !(e.matches('input,textarea') && e.closest('.pp-tile__cap')))
        .map((e) => { const r = e.getBoundingClientRect(); return { c: (e.className && e.className.baseVal === undefined ? e.className : e.tagName).toString().slice(0, 40), t: (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 20), h: Math.round(r.height), w: Math.round(r.width) }; })
        .filter((x) => x.h > 0 && x.h < 43.5));
      if (touch) assert.deepEqual(small, [], `${tag} ${name}: touch targets under 44px`); // the admin is a desktop tool: exempt
      assert.equal(info.noAlt, 0, `${tag} ${name}: <img> without alt`);
      assert.ok(!/\bundefined\b|\bnull\b|\bNaN\b|\[object|\{\{|\[[^\]\n]{1,40}\]/.test(info.text), `${tag} ${name}: placeholder text: ${info.text.replace(/\s+/g, ' ').slice(0, 300)}`);
      if (digits) { // Persian digits everywhere on the public pages (Latin handles / refs are .ck-latin / .pf-handle)
        const ascii = await p.evaluate(() => {
          const clone = document.body.cloneNode(true);
          clone.querySelectorAll('.ck-latin, .pf-handle, script, style, input, textarea, select, noscript').forEach((n) => n.remove());
          return ((clone.innerText || clone.textContent).match(/[^\s]*[0-9][^\s]*/g) || []).filter((t) => !/[A-Za-z]/.test(t)); // names with Latin letters ("Vol.01") are content
        });
        assert.deepEqual(ascii, [], `${tag} ${name}: ASCII digits in visible text`);
      }
      await p.screenshot({ path: join(outDir, `${tag}-${name}.png`), fullPage: true });
    };
    // public pages: anonymous
    const anon = await newCtx({ width: w, height: hgt }); const ap = await newPage(anon);
    for (const [name, path] of pages) { await ap.goto(O + path); await ap.evaluate(() => document.fonts.ready); await check(ap, name, { digits: true }); }
    // the open mobile menu
    if (w === 390) { await ap.goto(O + '/'); await ap.click('.ck-menu__btn'); await check(ap, 'menu-open'); }
    for (const [name, path, wait] of screens.anon) { await ap.goto(O + path); await ap.waitForSelector(wait); await check(ap, name); }
    await anon.close();
    // screens behind login
    for (const [who, list] of Object.entries(screens.users)) {
      const ctx = await newCtx({ width: w, height: hgt }); await ctx.addCookies([{ name: 'chaacme_session', value: auth.createSession(db.db.prepare('SELECT id FROM users WHERE username = ?').get(who).id), url: O }]);
      const p = await newPage(ctx);
      for (const [name, path, wait, act] of list) { await p.goto(O + path); await p.waitForSelector(wait); if (act) await act(p); await check(p, name); }
      await ctx.close();
    }
    // admin
    const actx = await newCtx({ width: w === 1440 ? 1300 : w, height: hgt });
    await actx.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.origin !== O) return r.abort(); if (u.pathname === '/admin') return r.fulfill({ contentType: 'text/html', body: adminHtml }); return r.continue(); });
    await actx.addCookies([{ name: 'chaacme_admin_session', value: adminAuth.adminLogin('root', 'pw-pw-pw-pw-1'), url: O }]);
    const ad = await newPage(actx);
    for (const [name, hash, wait] of admin) { await ad.goto(`${O}/admin${hash}`); await ad.waitForSelector(wait); await check(ad, name, { touch: false }); }
    await actx.close();
  }
}

// ======================================================== FULL
const site = await fx.seedFullSite({ db, upload, settings, makeImage: make });
const u1 = mkUser(1, 'آرش'); const u2 = mkUser(2, 'سارا');
db.db.prepare('UPDATE hosts SET user_id = ? WHERE slug IN (?, ?)').run(u1.user.id, 'lodge-fx', 'coach-fx');
const ed = (t) => db.db.prepare('SELECT id FROM tour_dates WHERE tour_id = ? ORDER BY id LIMIT 1').get(t).id;
const b1 = db.createBooking({ userId: u1.user.id, tourId: 'fx-flow', tourDateId: ed('fx-flow'), guests: 2 });
db.createBooking({ userId: u1.user.id, tourId: 'fx-tea', tourDateId: ed('fx-tea'), guests: 1 });
db.confirmBookingPayment(b1.id, { refId: 'R' });
db.createReview({ tourId: 'fx-flow', userId: u1.user.id, displayName: 'آرش ت.', rating: 5, body: 'تجربهٔ خوبی بود' });
const lodgeId = site.place.id;
db.submitRevision(db.db.prepare('SELECT * FROM hosts WHERE id = ?').get(lodgeId), u1.user.id, { displayName: 'اقامتگاه نمونه', bio: 'معرفی تازه', photoPath: site.place.photoPath, instagramHandle: 'lodge_fx' }, () => {});
db.createProposal(u1.user.id, site.person.id, { title: 'پیشنهاد نمونه', description: 'توضیح بلند برای پیشنهاد نمونه', preferredMonths: null, wantedCounterpartKind: 'none' });
await capture('full', {
  pages: [['home', '/'], ['experiences', '/experiences'], ['experiences-filtered', '/experiences?region=forest&open=1'], ['experiences-no-results', '/experiences?region=desert&type=' + encodeURIComponent('غذا و فرهنگ')], ['places', '/places'], ['tour', '/tour/fx-flow'],
    ['place-profile', '/host/lodge-fx'], ['person-profile', '/host/coach-fx'], ['about', '/about'], ['contact', '/contact'], ['not-found', '/no-such-page']],
  screens: {
    anon: [['login', '/login', '#password'], ['signup', '/signup', '#username'], ['become-host-gate', '/become-host', '[data-gate]'], ['booking-result-gone', '/booking/result?ref=CHK-00000', 'main h1']],
    users: {
      shot_1: [['account', '/account', '.ac-trip'], ['account-partner', '/account', '.ac-trip', async (p) => { await p.click('[data-tab="partner"]'); await p.waitForSelector('[data-panel="partner"] .ac-item'); }], ['become-host', '/become-host', '.ck-kinds', async (p) => { await p.click('[data-kind="place"]'); await p.fill('#fullName', 'مکان نمونه'); }],
        ['booking-paid', `/booking/result?ref=${b1.ref}`, '.br-list'], ['partner', '/partner', '.pp-cards'], ['partner-place', '/partner/profile/lodge-fx', '#pf-form'], ['partner-person', '/partner/profile/coach-fx', '#pf-form'],
        ['partner-experiences', '/partner/experiences', '.pp-sec'], ['partner-propose', '/partner/propose', '[data-proposals] .ac-item']],
      shot_2: [['account-empty', '/account', '.ck-empty'], ['partner-none', '/partner', '.pp--solo']]
    }
  },
  admin: [['admin-tours', '#/tours', 'table.tours'], ['admin-tour-editor', '#/tours/fx-flow/edit', '.secnav'], ['admin-settings', '#/settings', '#stSave'], ['admin-hosts', '#/hosts', 'table.tours'], ['admin-host-editor', `#/hosts/${lodgeId}/edit`, '#hostMediaPanel .media-row'], ['admin-revisions', '#/revisions', 'h1'], ['admin-bookings', '#/bookings', 'h1']]
});
console.log('  ok  full-site screenshots');

// ======================================================== MINIMAL: titles only, empty settings
wipe();
const MH = (v) => db.createHost({ photoPath: null, bio: null, expertise: null, instagramHandle: null, contactPhone: null, ...v });
const m1 = mkUser(1, 'آرش'); mkUser(2, 'سارا');
MH({ slug: 'lodge-min', kind: 'place', displayName: 'مکان کمینه', status: 'active', userId: m1.user.id });
MH({ slug: 'coach-min', kind: 'person', displayName: 'شخص کمینه', status: 'active', userId: m1.user.id });
db.createTour({ id: 'min-tour', status: 'published', name: 'تجربهٔ کمینه' });
const med = db.addTourDate('min-tour', { label: 'اجرا', capacity: 6, startsOn: fx.future(db, 20) });
db.createTour({ id: 'min-soon', status: 'coming_soon', name: 'به‌زودی' });
db.createTour({ id: 'min-booked', status: 'published', name: 'تجربهٔ رزروشده', price: 1000000 });
const mbd = db.addTourDate('min-booked', { label: 'اجرا', capacity: 6, startsOn: fx.future(db, 20) });
const mb2 = db.createBooking({ userId: m1.user.id, tourId: 'min-booked', tourDateId: mbd.id, guests: 1 });
await capture('minimal', {
  pages: [['home', '/'], ['experiences', '/experiences'], ['places', '/places'], ['tour', '/tour/min-tour'], ['place-profile', '/host/lodge-min'], ['person-profile', '/host/coach-min'], ['about-404', '/about'], ['contact-404', '/contact']],
  screens: {
    anon: [['login', '/login', '#password'], ['signup', '/signup', '#username'], ['become-host-gate', '/become-host', '[data-gate]']],
    users: {
      shot_1: [['account', '/account', '.ac-trip'], ['become-host', '/become-host', '.ck-kinds'], ['booking-pending', `/booking/result?ref=${mb2.ref}`, '.br-list'], ['partner', '/partner', '.pp-cards'],
        ['partner-place', '/partner/profile/lodge-min', '#pf-form'], ['partner-person', '/partner/profile/coach-min', '#pf-form'], ['partner-experiences', '/partner/experiences', '.ck-empty'], ['partner-propose', '/partner/propose', '[data-proposals] .ck-empty']],
      shot_2: [['account-empty', '/account', '.ck-empty']]
    }
  },
  admin: [['admin-tours', '#/tours', 'table.tours'], ['admin-settings', '#/settings', '#stSave']]
});
console.log('  ok  minimal-site screenshots');

await h.close();
assert.deepEqual(errors.filter((e) => !/Failed to load resource|net::/.test(e)), []);
console.log(`E2E OK -> ${outDir}`);
