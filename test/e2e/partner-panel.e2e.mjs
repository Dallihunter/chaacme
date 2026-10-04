import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'chaacme-e2e-'));
const PORT = 3600 + Math.floor(Math.random() * 300);
const IMAGES = join(dir, 'images');
Object.assign(process.env, {
  CHAACME_PLATFORM_DB: join(dir, 't.db'), IP_HASH_SALT: 'x'.repeat(24), OTP_PEPPER: 'y'.repeat(24),
  FRONTEND_STATIC_DIR: IMAGES, PORT: String(PORT), HOST: '127.0.0.1'
});
const repo = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const { server } = await import(repo + '/server/index.js');
const db = await import(repo + '/server/db.js');
const auth = await import(repo + '/server/auth.js');
const adminAuth = await import(repo + '/server/adminAuth.js');
if (!server.listening) await new Promise((r) => server.once('listening', r));
const O = `http://127.0.0.1:${PORT}`;
const { chromium } = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');

const outDir = join(homedir(), 'chaacme-verification', `${new Date().toISOString().slice(0, 10)}-partner-panel`);
rmSync(outDir, { recursive: true, force: true }); mkdirSync(outDir, { recursive: true });

db.seed();
adminAuth.upsertAdminUser('root', 'pw-pw-pw-pw-1');
const adminTok = adminAuth.adminLogin('root', 'pw-pw-pw-pw-1');
const mk = (n, first) => auth.signupWithPassword({ phone: `0912000010${n}`, firstName: first, lastName: 'تست', username: `e2e_user_${n}`, password: 'Passw0rd!xyz' });
const u1 = mk(1, 'آرش'), u2 = mk(2, 'سارا');
assert.ok(u1.ok && u2.ok, 'signups');

const indexHtml = readFileSync(repo + '/deploy/index.html', 'utf8');
const adminHtml = readFileSync(repo + '/deploy/admin-index.html', 'utf8');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const pngFile = join(dir, 'pic.png'); writeFileSync(pngFile, PNG);

const XSS = {
  name: '<img src=x onerror="window.__xss=1">اکو',
  bio: '<script>window.__xss=2</script> **bold** <b>x</b>',
  chip: '"><svg onload=window.__xss=3>',
  desc: '<img src=x onerror=window.__xss=4> توضیح بلند کافی',
};

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
async function newCtx(viewport, adminCookie) {
  const ctx = await browser.newContext({ viewport });
  if (adminCookie) await ctx.addCookies([{ name: 'chaacme_admin_session', value: adminTok, url: O }]);
  await ctx.route('**/*', async (r) => {
    const u = new URL(r.request().url());
    if (u.origin !== O) return r.abort();
    if (u.pathname.startsWith('/api/')) return r.continue();
    if (u.pathname.startsWith('/images/')) {
      const f = join(IMAGES, u.pathname.replace('/images/', ''));
      return existsSync(f) ? r.fulfill({ contentType: 'image/png', body: readFileSync(f) }) : r.fulfill({ status: 404, body: '' });
    }
    if (u.pathname === '/admin') return r.fulfill({ contentType: 'text/html', body: adminHtml });
    return r.fulfill({ contentType: 'text/html', body: indexHtml });
  });
  return ctx;
}
const errs = [];
async function page(ctx) {
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('dialog', (d) => d.accept('e2e note'));
  return p;
}
const shot = async (p, name) => { await p.waitForTimeout(800); return p.screenshot({ path: join(outDir, name + '.png'), fullPage: true }); };
const admin = (m, path, body) => fetch(O + '/api/admin' + path, { method: m, headers: { cookie: `chaacme_admin_session=${adminTok}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => null) }));
const noXss = async (p, label) => {
  const v = await p.evaluate(() => window.__xss);
  assert.equal(v, undefined, `XSS executed on ${label}: ${v}`);
};
async function login(p, phone) {
  await p.fill('#authPhone', phone);
  await p.fill('#authPasswordInput', 'Passw0rd!xyz');
  await p.waitForFunction(() => !document.getElementById('authPhoneBtn').disabled);
  await p.click('#authPhoneBtn');
}

for (const [label, viewport] of [['desktop', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  if (label === 'mobile') {
    // mobile pass: just visuals of the same states with the existing data
    const ctx = await newCtx(viewport);
    await ctx.addCookies([{ name: 'chaacme_session', value: auth.createSession(u1.user.id), url: O }]);
    const p = await page(ctx);
    for (const [name, path] of [['become-host', '/become-host'], ['partner-dashboard', '/partner'], ['partner-profile-person', '/partner/profile/' + 'echo-coach'],
      ['partner-experiences', '/partner/experiences'], ['partner-propose', '/partner/propose']]) {
      await p.goto(O + path); await p.waitForTimeout(700); await shot(p, `mobile-${name}`);
    }
    const ctx2 = await newCtx(viewport);
    await ctx2.addCookies([{ name: 'chaacme_session', value: auth.createSession(u2.user.id), url: O }]);
    const p2 = await page(ctx2);
    await p2.goto(O + '/partner/profile/lake-lodge'); await p2.waitForTimeout(700); await shot(p2, 'mobile-partner-profile-place');
    await ctx.close(); await ctx2.close();
    continue;
  }

  // ---- logged-out gate -> login -> returns to /become-host
  const ctx = await newCtx(viewport);
  const p = await page(ctx);
  await p.goto(O + '/become-host');
  await p.waitForSelector('#applyGate', { state: 'visible' });
  await shot(p, `${label}-1-become-host-logged-out`);
  await p.click('#applyGateLogin');
  await login(p, '09120000101');
  await p.waitForSelector('#applyMain', { state: 'visible' });
  assert.equal(await p.evaluate(() => location.pathname), '/become-host', 'returned to /become-host after login');
  assert.equal(await p.isVisible('#applyForm'), false, 'form hidden until a kind is chosen');
  await shot(p, `${label}-2-become-host-kind-cards`);

  // ---- apply as a person (XSS payloads in the text fields)
  await p.click('#applyKindPerson');
  assert.equal(await p.isVisible('#applyCapacityField'), false);
  await p.fill('#applyName', XSS.name);
  await p.fill('#applyExpertise', 'انیمال فلو <b>x</b>');
  await p.fill('#applyInstagram', 'echo.coach');
  await p.fill('#applyDescription', XSS.desc);
  await shot(p, `${label}-3-apply-person-form`);
  await p.click('#applySubmit');
  await p.waitForSelector('#applyDone', { state: 'visible' });
  await shot(p, `${label}-4-apply-success`);
  await noXss(p, 'apply success');

  // ---- apply as a place (second account)
  const ctx2 = await newCtx(viewport);
  const p2 = await page(ctx2);
  await p2.goto(O + '/become-host');
  await p2.click('#applyGateLogin');
  await login(p2, '09120000102');
  await p2.waitForSelector('#applyMain', { state: 'visible' });
  await p2.click('#applyKindPlace');
  assert.equal(await p2.isVisible('#applyCapacityField'), true);
  assert.equal(await p2.isVisible('#applyExpertiseField'), false);
  await p2.fill('#applyName', 'اقامتگاه دریاچه');
  await p2.fill('#applyLodging', 'بوم‌گردی');
  await p2.fill('#applyRegion', 'سوادکوه، مازندران');
  await p2.fill('#applyCapacity', '14');
  await p2.fill('#applyDescription', 'کلبه‌های چوبی کنار دریاچه و جنگل راش');
  await shot(p2, `${label}-5-apply-place-form`);
  await p2.click('#applySubmit');
  await p2.waitForSelector('#applyDone', { state: 'visible' });

  // ---- /partner before approval: friendly page
  await p.goto(O + '/partner');
  await p.waitForSelector('#partnerRoot .partner-box');
  assert.match(await p.textContent('#partnerRoot'), /در حال بررسی/);
  await shot(p, `${label}-6-partner-pending-application`);

  // ---- admin approves both (API) and sees application list in UI
  const apps = (await admin('GET', '/host-applications?status=pending')).data.applications;
  assert.equal(apps.length, 2);
  const slugFor = (a) => (a.kind === 'place' ? 'lake-lodge' : 'echo-coach');
  for (const a of apps) assert.equal((await admin('POST', `/host-applications/${a.id}/approve`, { slug: slugFor(a) })).status, 200);
  const pl = apps.find((a) => a.kind === 'place');
  assert.equal(pl.capacityGuests, 14);
  // admin activates profiles (as chaacme would after completing them)
  for (const slug of ['echo-coach', 'lake-lodge']) {
    const h = db.db.prepare('SELECT id FROM hosts WHERE slug = ?').get(slug);
    db.db.prepare("UPDATE hosts SET status = 'active' WHERE id = ?").run(h.id);
  }
  // link both to a tour (chaacme composes the experience)
  const tourId = db.listTours().find((t) => !t.comingSoon).id;
  const ids = ['echo-coach', 'lake-lodge'].map((s) => db.db.prepare('SELECT id FROM hosts WHERE slug = ?').get(s).id);
  db.setTourHosts(tourId, [{ hostId: ids[0], role: 'lead' }, { hostId: ids[1], role: 'venue' }]);

  // ---- person owner: dashboard + edit profile (XSS in every new text field)
  await p.goto(O + '/partner');
  await p.waitForSelector('#partnerRoot .partner-card');
  assert.equal(await p.isVisible('#navPartnerBtn'), true, 'nav link for owners');
  await shot(p, `${label}-7-partner-dashboard`);
  await p.click('a[href="/partner/profile/echo-coach"]');
  await p.waitForSelector('#partnerRoot form');
  assert.equal(await p.evaluate(() => location.pathname), '/partner/profile/echo-coach');
  const inputs = p.locator('#partnerRoot form input[type=text]');
  await p.fill('#partnerRoot form textarea >> nth=0', XSS.bio);
  await p.locator('#partnerRoot form textarea').nth(1).fill('گواهی <script>window.__xss=5</script>');
  await p.locator('#partnerRoot form .chips ~ div input').first().fill(XSS.chip);
  await p.locator('#partnerRoot form .chips ~ div button').first().click();
  await shot(p, `${label}-8-partner-profile-edit-person`);
  await p.click('#partnerRoot form button[type=submit]');
  await p.waitForFunction(() => /ارسال شد/.test(document.querySelector('#partnerRoot .partner-banner')?.textContent || ''));
  await shot(p, `${label}-9-partner-pending-banner`);
  assert.equal(db.getHostAdmin(ids[0]).bio, null, 'hosts untouched until approval');

  // ---- place owner: gallery upload + map point
  await p2.goto(O + '/partner/profile/lake-lodge');
  await p2.waitForSelector('#partnerRoot form');
  await p2.locator('#partnerRoot form input[type=file]').nth(1).setInputFiles([pngFile, pngFile]);
  await p2.waitForFunction(() => document.querySelectorAll('#partnerRoot .gal-list .gal-item').length >= 2);
  const num = p2.locator('#partnerRoot form input[type=number]');
  await num.nth(1).fill('36.5512345'); await num.nth(2).fill('52.9123456');
  await p2.locator('#partnerRoot .gal-list .gal-item input').first().fill('اتاق <b>1</b>');
  await p2.locator('#partnerRoot form textarea').nth(1).fill('سکوت بعد از ۱۰ شب');
  const chip = p2.locator('#partnerRoot form .chips ~ div input');
  await chip.nth(0).fill('آب گرم'); await chip.nth(0).press('Enter');
  await chip.nth(1).fill('ریتریت حرکتی'); await chip.nth(1).press('Enter');
  await shot(p2, `${label}-10-partner-profile-edit-place`);
  await p2.click('#partnerRoot form button[type=submit]');
  await p2.waitForFunction(() => /ارسال شد/.test(document.querySelector('#partnerRoot .partner-banner')?.textContent || ''));

  // ---- admin review queue UI with field-by-field diff
  const actx = await newCtx(viewport, true);
  const ap = await page(actx);
  await ap.goto(O + '/admin#/revisions');
  await ap.waitForSelector('.app-card');
  assert.equal(await ap.locator('.app-card').count(), 2);
  await shot(ap, `${label}-11-admin-revisions`);
  const cardTexts = await ap.locator('.rev-table').allTextContents();
  assert.ok(cardTexts.some((t) => t.includes('Gallery')), 'gallery diff shown');
  await noXss(ap, 'admin revisions');
  // approve place from UI, reject nothing yet; approve person through API
  await ap.locator('.app-card', { hasText: 'اقامتگاه دریاچه' }).locator('.rev-approve').click();
  await ap.waitForFunction(() => document.querySelectorAll('.app-card').length === 1);
  const pend = (await admin('GET', '/host-revisions?status=pending')).data.revisions;
  assert.equal((await admin('POST', `/host-revisions/${pend[0].id}/approve`, {})).status, 200);

  // ---- public pages now carry the approved data, rendered as text
  await p.goto(O + '/host/echo-coach'); await p.waitForTimeout(900);
  const hostText = await p.textContent('#page-host');
  assert.ok(hostText.includes('<script>window.__xss=2</script>'), 'bio shown as literal text');
  assert.equal(await p.locator('#page-host script, #page-host img[src="x"]').count(), 0);
  await noXss(p, 'public host page (person)');
  await shot(p, `${label}-12-public-host-person`);
  await p2.goto(O + '/host/lake-lodge'); await p2.waitForTimeout(900);
  assert.ok(await p2.locator('#page-host img[src^="/images/host-lake-lodge/"]').count() >= 1, 'gallery on public page');
  const lodgePublic = await (await fetch(O + '/api/hosts/lake-lodge')).text();
  for (const bad of ['36.5512345', '52.9123456', 'ریتریت حرکتی', 'سکوت بعد', 'seeking', 'accepts', '09120000102']) assert.equal(lodgePublic.includes(bad), false, 'public leak: ' + bad);
  await shot(p2, `${label}-13-public-host-place`);

  // ---- experiences (read-only) and propose
  await p.goto(O + '/partner/experiences');
  await p.waitForSelector('#partnerRoot .partner-card');
  await shot(p, `${label}-14-partner-experiences`);
  await p.goto(O + '/partner/propose');
  await p.waitForSelector('#partnerRoot form');
  await p.locator('#partnerRoot form input[type=text]').nth(0).fill('<img src=x onerror=window.__xss=6> سه روز انیمال فلو');
  await p.locator('#partnerRoot form textarea').fill(XSS.desc);
  await p.locator('#partnerRoot form select').last().selectOption('place');
  await p.click('#partnerRoot form button[type=submit]');
  await p.waitForSelector('#partnerRoot .partner-card');
  assert.equal(await p.locator('#partnerRoot .partner-card h3').first().textContent(), '<img src=x onerror=window.__xss=6> سه روز انیمال فلو');
  await noXss(p, 'proposals');
  await shot(p, `${label}-15-partner-propose`);
  await ap.goto(O + '/admin#/proposals'); await ap.waitForSelector('.app-card');
  await shot(ap, `${label}-16-admin-proposals`);
  await noXss(ap, 'admin proposals');
  await ap.goto(O + '/admin#/hosts/' + ids[1] + '/edit'); await ap.waitForSelector('#h_capacity');
  assert.equal(await ap.inputValue('#h_capacity'), '14');
  await shot(ap, `${label}-17-admin-host-place`);
  await ap.goto(O + '/admin#/hosts/' + ids[0] + '/edit'); await ap.waitForSelector('#h_seeking');
  await shot(ap, `${label}-18-admin-host-person`);
  await ctx.close(); await ctx2.close(); await actx.close();
}

await browser.close();
const real = errs.filter((e) => !/Failed to load resource|ERR_/.test(e));
console.log('page errors:', JSON.stringify(real));
assert.equal(real.length, 0);
console.log('E2E OK ->', outDir);
server.close();
rmSync(dir, { recursive: true, force: true });
process.exit(0);
