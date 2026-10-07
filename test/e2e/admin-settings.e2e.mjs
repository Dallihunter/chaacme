// Browser test for the restyled admin: the new «صفحهٔ اول و تنظیمات» screen end to end (uploads, text, footer links,
// info pages -> the public pages), the host editor's new fields, and screenshots of the admin screens.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { boot, repo } from './harness.mjs';

const h = await boot({ name: 'admin-settings' });
const { O, db, adminAuth, upload, settings, fx, dir, newCtx, newPage, shot, errors } = h;
const make = fx.imageMaker(upload, join(dir, 'work'));
await fx.seedFullSite({ db, upload, settings, makeImage: make });
// start from an EMPTY settings table so the admin has to create everything
db.db.prepare('DELETE FROM site_settings').run();
adminAuth.upsertAdminUser('root', 'pw-pw-pw-pw-1');
const adminHtml = readFileSync(`${repo}/deploy/admin-index.html`, 'utf8');

const jpg = join(dir, 'poster.jpg'); const jpg2 = join(dir, 'fallback.jpg');
await (async () => { const { execFileSync } = await import('node:child_process'); execFileSync('convert', ['-size', '1600x900', 'gradient:#2f5d46-#d9a23a', `jpeg:${jpg}`]); execFileSync('convert', ['-size', '1600x900', 'gradient:#1f6b78-#a84b24', `jpeg:${jpg2}`]); })();
const mp4 = join(dir, 'hero.mp4'); writeFileSync(mp4, Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(8), Buffer.alloc(512)]));
const notMp4 = join(dir, 'fake.mp4'); writeFileSync(notMp4, readFileSync(jpg));

const ctx = await newCtx({ width: 1300, height: 1000 });
await ctx.route('**/*', (r) => {
  const u = new URL(r.request().url());
  if (u.origin !== O) return r.abort();
  if (u.pathname === '/admin' || u.pathname === '/admin/') return r.fulfill({ contentType: 'text/html', body: adminHtml });
  return r.continue();
});
const p = await newPage(ctx);
await p.goto(`${O}/admin`);
await p.waitForSelector('#loginForm');
await shot(p, 'd-admin-login.png');
await p.fill('#loginUsername', 'root'); await p.fill('#loginPassword', 'pw-pw-pw-pw-1');
await p.click('#loginSubmit');
await p.waitForSelector('table.tours');
assert.ok((await p.innerText('.ck-site-header--admin')).includes('صفحهٔ اول'), 'admin nav lists the settings screen');
assert.equal(await p.locator('.ck-site-header--admin').count(), 1, 'the shared header, admin variant');
await shot(p, 'd-admin-tours.png');

// every link of the header opens its own screen (the shared header once turned the admin's #/... routes into dead "#" links)
for (const [key, title] of [['hosts', 'همکاران'], ['applications', 'درخواست‌ها'], ['revisions', 'بازبینی'], ['proposals', 'پیشنهاد'], ['bookings', 'رزروها'], ['settings', 'صفحهٔ اول'], ['tours', 'تجربه‌ها']]) {
  await p.click(`nav.ck-site-nav a[href="/admin/#/${key}"]`);
  await p.waitForFunction((k) => location.hash === `#/${k}`, key);
  await p.waitForFunction((t) => (document.querySelector('#app h1') || {}).textContent?.includes(t), title);
}
console.log('  ok  every admin header link opens its screen');

// ---- settings: empty site -> fill everything
await p.goto(`${O}/admin#/settings`);
await p.waitForSelector('#stSave');
assert.equal(await p.locator('[data-media]').count(), 6);
const upTo = async (key, file) => { const box = p.locator(`[data-media="${key}"]`); await box.locator('input[type=file]').setInputFiles(file); await box.locator('[data-up]').click(); };
await upTo('home_hero_poster', jpg);
await p.waitForSelector('[data-media="home_hero_poster"] img');
await upTo('home_hero_image', jpg2);
await p.waitForSelector('[data-media="home_hero_image"] img');
await upTo('home_hero_video', notMp4);
await p.waitForSelector('#toast.err');
assert.equal(await p.locator('[data-media="home_hero_video"] video').count(), 0, 'a renamed image is refused as a video');
await upTo('home_hero_video', mp4);
await p.waitForSelector('[data-media="home_hero_video"] video');
const XSS = '"><img src=x onerror="window.__xss=1"><script>window.__xss=2</script>';
await p.fill('#s_home_hero_headline', `تیتر ${XSS}`.slice(0, 120));
await p.fill('#s_home_hero_subline', 'زیرتیتر آزمایشی');
await p.fill('#s_home_cta_primary', 'ببین'); await p.fill('#s_home_cta_secondary', 'چطور کار می‌کند');
await p.fill('#s_explainer_title', 'سه تکه'); await p.fill('#s_explainer_text', 'متن توضیح');
await p.fill('#s_explainer_1_title', 'الف'); await p.fill('#s_explainer_2_title', 'ب'); await p.fill('#s_explainer_3_title', 'ج');
await upTo('explainer_1_image', jpg);
await p.waitForSelector('[data-media="explainer_1_image"] img');
await p.fill('#s_become_host_title', 'همکار شو'); await p.fill('#s_become_host_cta', 'همکاری');
await p.fill('#s_instagram_handle', '@chaacme_test');
await p.click('#stAddLink');
await p.fill('#stLinks [data-l="label"]', 'مکان‌ها'); await p.fill('#stLinks [data-l="href"]', '/places');
await p.fill('#s_contact_phone', '۰۲۱۱۲۳۴۵۶۷۸'); await p.fill('#s_contact_email', 'team@chaacme.test'); await p.fill('#s_contact_hours', 'شنبه تا چهارشنبه');
await p.fill('#s_page_about', `پاراگراف یک\n\n${XSS}`);
await p.fill('#s_page_privacy', 'حریم خصوصی من');
await shot(p, 'd-admin-settings.png');
await p.click('#stSave');
await p.waitForFunction(() => document.getElementById('stMsg').textContent.includes('ذخیره شد'));
const saved = settings.getSettings();
assert.match(saved.home_hero_video, /^\/images\/site\/hero-.+\.mp4$/);
assert.match(saved.home_hero_poster, /^\/images\/site\/.+\.jpg$/);
assert.equal(saved.instagram_handle, 'chaacme_test');
assert.equal(saved.page_terms, null);
// a bad value is reported, nothing is half-saved
await p.fill('#stLinks [data-l="href"]', 'javascript:alert(1)');
await p.click('#stSave');
await p.waitForFunction(() => document.getElementById('stMsg').textContent.includes('footer_links'));
assert.equal(settings.getSettings().footer_links.includes('places'), true, 'unchanged');
await p.fill('#stLinks [data-l="href"]', '/places');

// ---- public pages reflect it
const pub = await ctx.newPage();
await pub.goto(`${O}/`);
await pub.waitForSelector('.hm-hero');
const home = await pub.content();
assert.ok(home.includes('<video') && home.includes('hero-') && home.includes('همکار شو') && home.includes('href="/privacy"') && home.includes('href="/about"') && !home.includes('href="/terms"') && home.includes('href="/places"') && home.includes('instagram.com/chaacme_test'));
assert.equal(await pub.evaluate(() => window.__xss), undefined, 'payload in the headline did not run');
assert.equal((await pub.goto(`${O}/terms`)).status(), 404, 'empty info page');
assert.equal((await pub.goto(`${O}/contact`)).status(), 200);
assert.ok((await pub.content()).includes('href="tel:02112345678"') && (await pub.content()).includes('href="mailto:team@chaacme.test"') && !(await pub.innerText('main')).includes('نشانی'));
assert.ok((await (await pub.goto(`${O}/`)).text()).includes('href="/contact"'), 'footer link');
const about = await pub.goto(`${O}/about`);
assert.equal(about.status(), 200);
assert.equal(await pub.evaluate(() => window.__xss), undefined);
assert.ok((await pub.innerText('.in-body')).includes('onerror'), 'payload shown as text');
await shot(pub, 'd-about.png');
await pub.goto(`${O}/`); await pub.waitForSelector('.hm-hero'); await shot(pub, 'd-home-from-admin.png');

// ---- tour editor: sections with «روی صفحه» hints and the left nav
await p.goto(`${O}/admin#/tours/fx-flow/edit`);
await p.waitForSelector('.secnav');
assert.equal(await p.locator('section.panel .where').count() >= 6, true);
assert.ok((await p.innerText('main')).includes('روی صفحه: بالای صفحه و کارت تجربه'));
await p.click('.secnav [data-sec="sec-5"]');
await p.waitForSelector('table.editions');
await shot(p, 'd-admin-tour-editor.png');

// ---- revisions: an owner's opt-in to publish credentials shows up as a diff row
const owner = db.db.prepare("SELECT id FROM users LIMIT 1").get().id;
const coach = db.db.prepare("SELECT * FROM hosts WHERE slug = 'coach-fx'").get();
db.db.prepare('UPDATE hosts SET credentials_public = 0 WHERE id = ?').run(coach.id);
db.submitRevision(coach, owner, { displayName: coach.display_name, bio: coach.bio, photoPath: coach.photo_path, instagramHandle: coach.instagram_handle, expertise: coach.expertise, credentials: coach.credentials, credentialsPublic: true, seekingPlaceTypes: null }, () => {});
await p.goto(`${O}/admin#/revisions`);
await p.waitForSelector('.rev-table');
assert.ok((await p.innerText('.rev-table')).includes('نمایش عمومی سوابق') && (await p.innerText('.rev-table')).includes('عمومی'), 'credentials opt-in is visible to the reviewer');
await shot(p, 'd-admin-revision-credentials.png');
// the host editor has the checkbox, off by default
await p.goto(`${O}/admin#/hosts/${coach.id}/edit`);
await p.waitForSelector('#h_credentialsPublic');
assert.equal(await p.isChecked('#h_credentialsPublic'), false);
await p.check('#h_credentialsPublic'); await p.click('#hostSaveBtn'); await p.waitForTimeout(500);
assert.equal(db.getHostAdmin(coach.id).credentialsPublic, true);

// ---- host editor: region stamp + gallery alt
const lodge = db.db.prepare("SELECT id FROM hosts WHERE slug = 'lodge-fx'").get().id;
await p.goto(`${O}/admin#/hosts/${lodge}/edit`);
await p.waitForSelector('#h_regionKey');
assert.equal(await p.inputValue('#h_regionKey'), 'forest');
await p.selectOption('#h_regionKey', 'sea');
await p.waitForSelector('#hostMediaPanel .media-row');
await p.locator('.gm-alt').first().fill('متن جایگزین تازه');
await p.locator('.gm-caption').first().fill('زیرنویس تازه');
await p.click('#gmSave');
await p.waitForFunction(() => document.querySelector('#toast.show'));
await p.click('#hostSaveBtn');
await p.waitForFunction(() => document.querySelector('#toast.show')?.textContent.length > 0);
await p.waitForTimeout(400);
const row = db.getHostAdmin(lodge);
assert.equal(row.regionKey, 'sea');
assert.deepEqual([row.media[0].alt, row.media[0].caption], ['متن جایگزین تازه', 'زیرنویس تازه']);
const prof = await (await fetch(`${O}/host/lodge-fx`)).text();
assert.ok(prof.includes('alt="متن جایگزین تازه"') && prof.includes('ck-stamp--sea'));
await shot(p, 'd-admin-host-editor.png');
for (const path of ['#/hosts', '#/applications', '#/revisions', '#/proposals', '#/bookings']) {
  await p.goto(`${O}/admin${path}`); await p.waitForSelector('h1'); await p.waitForTimeout(250);
  await shot(p, `d-admin-${path.slice(2)}.png`);
}
// mobile admin: the compact bar and a stacked editor
const mctx = await newCtx({ width: 390, height: 844 });
await mctx.route('**/*', (r) => { const u = new URL(r.request().url()); if (u.origin !== O) return r.abort(); if (u.pathname === '/admin') return r.fulfill({ contentType: 'text/html', body: adminHtml }); return r.continue(); });
await mctx.addCookies((await ctx.cookies()));
const mp = await newPage(mctx);
await mp.goto(`${O}/admin#/settings`); await mp.waitForSelector('#stSave');
assert.equal(await mp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'no horizontal scroll on a phone');
await shot(mp, 'm-admin-settings.png');
await mp.goto(`${O}/admin#/tours/fx-flow/edit`); await mp.waitForSelector('.secnav'); await shot(mp, 'm-admin-tour-editor.png');

await h.close();
assert.deepEqual(errors.filter((e) => !/Failed to load resource|net::/.test(e)), []);
console.log('E2E OK');
