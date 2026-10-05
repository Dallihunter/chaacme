import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'chaacme-set-'));
const PORT = 4800 + Math.floor(Math.random() * 300);
const IMAGES = join(dir, 'images');
Object.assign(process.env, {
  CHAACME_PLATFORM_DB: join(dir, 't.db'), IP_HASH_SALT: 'x'.repeat(24), OTP_PEPPER: 'y'.repeat(24),
  FRONTEND_STATIC_DIR: IMAGES, PORT: String(PORT), HOST: '127.0.0.1', FRONTEND_ORIGIN: 'https://chaacme.test'
});
const ORIGIN = 'https://chaacme.test';
const { server } = await import('../server/index.js');
const db = await import('../server/db.js');
const auth = await import('../server/auth.js');
const adminAuth = await import('../server/adminAuth.js');
const settings = await import('../server/settings.js');
const base = `http://127.0.0.1:${PORT}`;
before(async () => { if (!server.listening) await new Promise((r) => server.once('listening', r)); });
after(() => server.close());

let admin; let userToken;
before(() => {
  db.seed();
  adminAuth.upsertAdminUser('root', 'pw-pw-pw-pw');
  admin = adminAuth.adminLogin('root', 'pw-pw-pw-pw');
  const id = Number(db.db.prepare("INSERT INTO users (phone, first_name, last_name, username) VALUES ('09120000777','n','m','set_user')").run().lastInsertRowid);
  userToken = auth.createSession(id);
});
async function call(method, path, { token, adminTok, body, raw, headers = {} } = {}) {
  const h = { origin: ORIGIN, ...headers };
  if (token) h.cookie = `chaacme_session=${token}`;
  if (adminTok) h.cookie = `chaacme_admin_session=${adminTok}`;
  let payload = raw;
  if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + path, { method, headers: h, body: payload });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch { /* */ }
  return { status: res.status, data, text };
}
const put = (values, adminTok = admin) => call('PUT', '/api/admin/settings', { adminTok, body: { values } });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'); // a real 1x1 PNG
const mp4 = (extra = 64) => Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(8), Buffer.alloc(extra)]);
function multipart(buf, { filename = 'a.bin', fields = {}, type = 'application/octet-stream' } = {}) {
  const b = '----t' + Math.random().toString(16).slice(2);
  const parts = Object.entries(fields).map(([k, v]) => `--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('');
  const head = Buffer.from(`${parts}--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`);
  return { raw: Buffer.concat([head, buf, Buffer.from(`\r\n--${b}--\r\n`)]), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}

test('settings are admin-only (read and write), same-origin, JSON only', async () => {
  assert.equal((await call('GET', '/api/admin/settings')).status, 401);
  assert.equal((await call('GET', '/api/admin/settings', { token: userToken })).status, 401);
  assert.equal((await put({ home_hero_headline: 'x' }, null)).status, 401);
  assert.equal((await call('PUT', '/api/admin/settings', { adminTok: admin, body: { values: {} }, headers: { origin: 'https://evil.example' } })).status, 403);
  assert.equal((await call('PUT', '/api/admin/settings', { adminTok: admin, raw: 'values=1', headers: { 'content-type': 'text/plain' } })).status, 415);
  const r = await call('GET', '/api/admin/settings', { adminTok: admin });
  assert.equal(r.status, 200);
  assert.ok(Object.values(r.data.settings).every((v) => v === null), 'nothing is seeded');
  assert.equal(r.data.fields.page_about.max, 20000);
});

test('validation: lengths, unknown keys, paths, handle, footer links', async () => {
  const bad = async (values, key, code) => {
    const r = await put(values);
    assert.equal(r.status, 422, JSON.stringify(values));
    assert.equal(r.data.fields[key], code, key);
  };
  await bad({ nope: 'x' }, 'nope', 'unknown');
  await bad({ home_hero_headline: 'x'.repeat(121) }, 'home_hero_headline', 'length');
  await bad({ page_terms: 'x'.repeat(20001) }, 'page_terms', 'length');
  await bad({ home_hero_poster: 'https://evil.example/a.jpg' }, 'home_hero_poster', 'format');
  await bad({ home_hero_poster: '/images/site/../../etc/passwd' }, 'home_hero_poster', 'format');
  await bad({ home_hero_poster: '/images/host-x/pending/a.jpg' }, 'home_hero_poster', 'format');
  await bad({ home_hero_video: '/images/site/a.jpg' }, 'home_hero_video', 'format');
  await bad({ home_hero_video: '/images/uploads/a.mp4' }, 'home_hero_video', 'format');
  await bad({ instagram_handle: 'bad handle!' }, 'instagram_handle', 'format');
  for (const phone of ['abc', 'javascript:1', '12', '+98 21 <b>', '0'.repeat(31), '123456; DROP']) await bad({ contact_phone: phone }, 'contact_phone', 'format');
  for (const email of ['nope', 'a@b', '<x>@y.com', 'a@b.com\nbcc:evil@x.com', 'javascript:alert(1)//@x.com', 'a b@c.com']) await bad({ contact_email: email }, 'contact_email', 'format');
  await bad({ contact_address: 'x'.repeat(301) }, 'contact_address', 'length');
  await bad({ contact_hours: 'x'.repeat(201) }, 'contact_hours', 'length');
  await bad({ home_cta_primary: 5 }, 'home_cta_primary', 'type');
  await bad({ footer_links: [{ label: 'x', href: 'javascript:alert(1)' }] }, 'footer_links', 'href');
  await bad({ footer_links: [{ label: 'x', href: 'http://plain.example' }] }, 'footer_links', 'href');
  await bad({ footer_links: [{ label: 'x', href: '/admin' }] }, 'footer_links', 'href');
  await bad({ footer_links: [{ label: 'x', href: '//evil.example' }] }, 'footer_links', 'href');
  await bad({ footer_links: [{ label: '', href: '/about' }] }, 'footer_links', 'label');
  await bad({ footer_links: Array.from({ length: 9 }, () => ({ label: 'a', href: '/about' })) }, 'footer_links', 'length');
  await bad({ footer_links: 'nope' }, 'footer_links', 'type');
  assert.equal((await call('PUT', '/api/admin/settings', { adminTok: admin, body: { values: [] } })).status, 422);
  assert.ok(Object.values(settings.getSettings()).every((v) => v === null), 'a rejected save writes nothing');
});

test('values are normalised and plain text; empty deletes', async () => {
  const r = await put({
    home_hero_headline: '  سفر\n  از   آدم‌ها  ', page_about: 'یک\r\n\r\n\r\n\r\nدو  \n  \nسه', instagram_handle: 'https://www.instagram.com/chaacme/',
    footer_links: [{ label: ' وبلاگ ', href: 'https://blog.example/x' }, { label: 'تجربه‌ها', href: '/experiences' }, { label: '', href: '' }]
  });
  assert.equal(r.status, 200);
  const s = r.data.settings;
  assert.equal(s.home_hero_headline, 'سفر از آدم‌ها');
  assert.equal(s.page_about, 'یک\n\nدو\n\nسه');
  assert.equal(s.instagram_handle, 'chaacme');
  assert.deepEqual(JSON.parse(s.footer_links), [{ label: 'وبلاگ', href: 'https://blog.example/x' }, { label: 'تجربه‌ها', href: '/experiences' }]);
  assert.deepEqual(settings.infoParagraphs(s.page_about), ['یک', 'دو', 'سه']);
  const cleared = await put({ home_hero_headline: '', page_about: null, footer_links: [], instagram_handle: '@' });
  assert.equal(cleared.status, 200);
  assert.ok(Object.values(cleared.data.settings).every((v) => v === null));
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM site_settings').get().n, 0, 'rows are deleted, not stored empty');
});

test('contact settings are normalised: ASCII digits stored, empty deletes', async () => {
  const r = await put({ contact_phone: ' ۰۲۱ - ۱۲۳۴۵۶۷۸ ', contact_email: ' team@chaacme.example ', contact_address: 'خیابان\r\n\r\n\r\nنمونه', contact_hours: '' });
  assert.equal(r.status, 200, r.text);
  const s = r.data.settings;
  assert.deepEqual([s.contact_phone, s.contact_email, s.contact_address, s.contact_hours], ['021 - 12345678', 'team@chaacme.example', 'خیابان\n\nنمونه', null]);
  assert.deepEqual(settings.contactDetails(s).address, ['خیابان', 'نمونه']);
  await put({ contact_phone: '', contact_email: '', contact_address: '' });
  assert.equal(settings.contactDetails(), null);
});

test('footer: only pages that exist; info links appear once their body is written', async () => {
  const ctx = () => settings.siteContext();
  assert.deepEqual(ctx().footerLinks, [{ label: 'همکاری با چکمه', href: '/become-host' }]);
  await put({ footer_links: [{ label: 'قوانین', href: '/terms' }, { label: 'درباره', href: '/about' }, { label: 'مکان‌ها', href: '/places' }], instagram_handle: 'chaacme' });
  // /terms and /about have no body: their links are not rendered, wherever they came from
  assert.deepEqual(ctx().footerLinks.map((l) => l.href), ['/become-host', '/places', 'https://instagram.com/chaacme']);
  await put({ page_terms: 'متن قوانین', page_privacy: 'متن حریم خصوصی' });
  assert.deepEqual(ctx().footerLinks.map((l) => l.href), ['/become-host', '/terms', '/privacy', '/places', 'https://instagram.com/chaacme']);
  await put({ page_terms: '', page_privacy: '', footer_links: [], instagram_handle: '' });
  assert.equal(ctx().footerLinks.length, 1);
});

test('site images: upload with site=1 lands in /images/site/ and a replaced file is deleted when nothing uses it', async () => {
  const m = multipart(PNG, { filename: 'p.png', fields: { site: '1' } });
  const up = await call('POST', '/api/admin/upload', { adminTok: admin, raw: m.raw, headers: m.headers });
  assert.equal(up.status, 201, up.text);
  assert.match(up.data.path, /^\/images\/site\/\d+-[0-9a-f]+\.png$/);
  const file = join(IMAGES, up.data.path.replace('/images/', ''));
  assert.ok(existsSync(file));
  assert.equal((await put({ home_hero_poster: up.data.path })).status, 200);
  assert.ok(existsSync(file), 'still used');
  await put({ home_hero_poster: up.data.path, home_hero_image: up.data.path });
  await put({ home_hero_poster: '' });
  assert.ok(existsSync(file), 'another setting still uses it');
  await put({ home_hero_image: '' });
  assert.ok(!existsSync(file), 'orphan removed');
});

test('hero video: mp4 magic bytes only, size cap, admin only, stored untouched', async () => {
  const send = (buf, opts, tok = admin) => { const m = multipart(buf, opts); return call('POST', '/api/admin/upload-video', { adminTok: tok, raw: m.raw, headers: m.headers }); };
  assert.equal((await send(mp4(), { filename: 'h.mp4' }, null)).status, 401);
  const ok = await send(mp4(), { filename: 'whatever.exe', type: 'text/plain' });
  assert.equal(ok.status, 201, ok.text);
  assert.match(ok.data.path, /^\/images\/site\/hero-\d+-[0-9a-f]+\.mp4$/);
  assert.ok(existsSync(join(IMAGES, ok.data.path.replace('/images/', ''))));
  assert.equal((await send(PNG, { filename: 'fake.mp4', type: 'video/mp4' })).data.error, 'unsupported_file_type', 'an image renamed .mp4');
  assert.equal((await send(Buffer.from('<html>'), { filename: 'x.mp4' })).data.error, 'unsupported_file_type');
  assert.equal((await send(Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypXXXX'), Buffer.alloc(40)]))).data.error, 'unsupported_file_type', 'unknown brand');
  assert.equal((await send(Buffer.alloc(0))).data.error, 'file_required');
  const big = await send(mp4(31 * 1024 * 1024));
  assert.equal(big.status, 413);
  assert.equal(big.data.error === 'file_too_large' || big.data.error === 'payload_too_large', true);
  // the saved path is accepted as the hero video setting
  assert.equal((await put({ home_hero_video: ok.data.path })).status, 200);
  const file = join(IMAGES, ok.data.path.replace('/images/', ''));
  await put({ home_hero_video: '' });
  assert.ok(!existsSync(file), 'replaced/removed video is deleted');
  // a plain JSON content-type on the upload route is refused by the guard
  assert.equal((await call('POST', '/api/admin/upload-video', { adminTok: admin, body: {} })).status, 415);
});

test('host profile fields: region key (admin only) and gallery alt', async () => {
  const h = db.createHost({ slug: 'alt-lodge', kind: 'place', displayName: 'اقامتگاه', region: 'جایی', status: 'active', photoPath: null, bio: null, expertise: null, instagramHandle: null, contactPhone: null });
  const r = await call('PUT', `/api/admin/hosts/${h.id}`, { adminTok: admin, body: { displayName: 'اقامتگاه', region: 'جایی', regionKey: 'forest', status: 'active' } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.data.host.regionKey, 'forest');
  assert.equal((await call('PUT', `/api/admin/hosts/${h.id}`, { adminTok: admin, body: { displayName: 'اقامتگاه', regionKey: 'moon' } })).status, 422);
  // a save that does not mention regionKey keeps it
  assert.equal((await call('PUT', `/api/admin/hosts/${h.id}`, { adminTok: admin, body: { displayName: 'اقامتگاه', region: 'جایی' } })).data.host.regionKey, 'forest');
  const media = await call('PUT', `/api/admin/hosts/${h.id}/media`, { adminTok: admin, body: { media: [{ photoPath: '/images/host-alt-lodge/a.jpg', caption: 'زیرنویس', alt: 'متن جایگزین' }] } });
  assert.equal(media.status, 200, media.text);
  assert.deepEqual([media.data.media[0].caption, media.data.media[0].alt], ['زیرنویس', 'متن جایگزین']);
  assert.equal((await call('PUT', `/api/admin/hosts/${h.id}/media`, { adminTok: admin, body: { media: [{ photoPath: '/images/host-alt-lodge/a.jpg', alt: 'x'.repeat(161) }] } })).status, 422);
  const person = db.createHost({ slug: 'alt-person', kind: 'person', displayName: 'شخص', status: 'active', photoPath: null, bio: null, expertise: null, instagramHandle: null, contactPhone: null });
  assert.equal((await call('PUT', `/api/admin/hosts/${person.id}`, { adminTok: admin, body: { displayName: 'شخص', regionKey: 'desert' } })).data.host.regionKey, null, 'a person has no stamp');
  void writeFileSync; void mkdirSync;
});
