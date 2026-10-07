import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// What picture an experience card shows: the explicit cover («عکس کاور», tours.photo_path), else the first gallery photo; the
// frame is empty only when the tour has no usable image. Includes the production case that broke it: gallery rows stored
// without the leading slash (images/<dir>/<file>), which the pages refuse, and migration 006 that repairs them.
const dir = mkdtempSync(join(tmpdir(), 'chaacme-cover-'));
const PORT = 6700 + Math.floor(Math.random() * 250);
Object.assign(process.env, {
  CHAACME_PLATFORM_DB: join(dir, 't.db'), IP_HASH_SALT: 'x'.repeat(24), OTP_PEPPER: 'y'.repeat(24),
  FRONTEND_STATIC_DIR: join(dir, 'images'), SITE_ORIGIN: 'https://example.test/', PORT: String(PORT), HOST: '127.0.0.1', FRONTEND_ORIGIN: 'https://example.test'
});
const { server } = await import('../server/index.js');
const db = await import('../server/db.js');
const upload = await import('../server/upload.js');
const adminAuth = await import('../server/adminAuth.js');
const migrations = (await import('../server/migrations/index.js')).default;
const fx = await import('./support/fixtures.mjs');
const base = `http://127.0.0.1:${PORT}`;
before(async () => { if (!server.listening) await new Promise((r) => server.once('listening', r)); });
after(() => server.close());

const makeImage = fx.imageMaker(upload, join(dir, 'fx'));
const get = async (path) => { const res = await fetch(base + path); return { status: res.status, text: await res.text() }; };
/** The card of one tour on a page: its <a class="ck-xcard"> block. */
const card = (html, slug) => (html.match(/<a class="ck-xcard"[\s\S]*?<\/a>/g) || []).find((c) => c.includes(`href="/tour/${slug}"`)) || null;
const photoOf = (c) => (c.match(/<div class="ck-photo[^"]*">([\s\S]*?)<\/div>/) || [])[1] || '';
const srcOf = (c) => (photoOf(c).match(/<img[^>]*\ssrc="([^"]+)"/) || [])[1] || null;
const pathsOf = (tourId, n) => Promise.all(Array.from({ length: n }, (_, i) => makeImage({ tourId }, 1600 - i * 100, 1000)));

const skip = !fx.hasMagick && 'ImageMagick (convert) is not available';
const mk = (tour) => db.createTour({ status: 'published', price: 1000, ...tour });

test('a tour with a gallery and no explicit cover shows the first gallery photo on its card (home, /experiences, related row)', { skip }, async () => {
  const g = await pathsOf('gal-only', 3);
  mk({ id: 'gal-only', name: 'فقط گالری', galleryImages: ['الف', 'ب', 'پ'], galleryPhotos: g });
  mk({ id: 'other', name: 'دیگری' });
  for (const page of ['/experiences', '/']) {
    const c = card((await get(page)).text, 'gal-only');
    assert.ok(c, `${page}: card present`);
    const src = srcOf(c);
    assert.ok(src, `${page}: the card has an image`);
    assert.ok(src.startsWith(g[0].replace(/\.jpg$/, '.w')) || src === g[0], `${page}: first gallery photo, got ${src}`);
  }
  const related = card((await get('/tour/other')).text, 'gal-only');
  assert.ok(related && srcOf(related), 'related row on a tour page');
});

test('the explicit cover wins over the gallery', { skip }, async () => {
  const [cover] = await pathsOf('both', 1);
  const g = await pathsOf('both', 2);
  mk({ id: 'both', name: 'هر دو', photoPath: cover, galleryImages: ['الف', 'ب'], galleryPhotos: g });
  const src = srcOf(card((await get('/experiences')).text, 'both'));
  assert.ok(src && src.startsWith(cover.replace(/\.jpg$/, '.w')), `cover first, got ${src}`);
  // the tour page itself still opens on the first gallery photo (the admin says: first = main photo)
  const page = JSON.parse((await get('/api/pages/tour/both')).text).page;
  assert.equal(page.cover.path, g[0]);
});

test('an empty frame only when the tour has no image at all', { skip }, async () => {
  mk({ id: 'none', name: 'بدون عکس', galleryImages: ['فقط برچسب'], galleryPhotos: [] });
  const c = card((await get('/experiences')).text, 'none');
  assert.ok(c, 'the card is there');
  assert.ok(c.includes('ck-photo') && !/<img/.test(c), 'the frame is empty: no <img>');
});

test('production case: gallery paths without the leading slash do not hide a valid cover or a later usable photo', { skip }, async () => {
  const [cover] = await pathsOf('legacy', 1);
  const [good] = await pathsOf('legacy2', 1);
  const stale = ['images/tour-legacy/01.jpg', 'images/tour-legacy/02.jpg'];
  mk({ id: 'legacy', name: 'قدیمی با کاور', photoPath: cover, galleryImages: ['الف', 'ب'], galleryPhotos: stale });
  mk({ id: 'legacy2', name: 'قدیمی بی‌کاور', galleryImages: ['الف', 'ب', 'پ'], galleryPhotos: [stale[0], good, stale[1]] });
  const html = (await get('/experiences')).text;
  assert.ok(srcOf(card(html, 'legacy')).startsWith(cover.replace(/\.jpg$/, '.w')), 'explicit cover used although the first gallery row is unusable');
  assert.ok(srcOf(card(html, 'legacy2')).startsWith(good.replace(/\.jpg$/, '.w')), 'next usable gallery photo used');
});

test('migration 006 puts the leading slash on legacy image paths, leaves everything else alone, and is a no-op the second time', { skip }, async () => {
  const [a, b] = await pathsOf('fixme', 2);
  const rel = (p) => p.replace(/^\//, '');
  mk({ id: 'fixme', name: 'اصلاح', galleryImages: ['الف', 'ب'], galleryPhotos: [rel(a), rel(b)] });
  const before = db.db.prepare('SELECT image_path FROM tour_media WHERE tour_id = ? ORDER BY ordinal').all('fixme').map((r) => r.image_path);
  assert.deepEqual(before, [rel(a), rel(b)]);
  const cover = db.db.prepare('SELECT photo_path FROM tours WHERE id = ?').get('legacy');
  const m006 = migrations.find((m) => m.id === 6);
  m006.up(db.db);
  const after1 = db.db.prepare('SELECT image_path FROM tour_media WHERE tour_id = ? ORDER BY ordinal').all('fixme').map((r) => r.image_path);
  assert.deepEqual(after1, [a, b]);
  assert.deepEqual(db.db.prepare('SELECT photo_path FROM tours WHERE id = ?').get('legacy'), cover, 'absolute paths are not touched');
  m006.up(db.db);
  assert.deepEqual(db.db.prepare('SELECT image_path FROM tour_media WHERE tour_id = ? ORDER BY ordinal').all('fixme').map((r) => r.image_path), [a, b]);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS n FROM tour_media WHERE image_path LIKE 'images/%'").get().n, 0, 'no legacy row is left in any tour');

  // the gallery shows on the tour page now, and the admin can add a photo (the editor re-sends the whole list; the validator accepts it)
  const page = JSON.parse((await get('/api/pages/tour/fixme')).text).page;
  assert.deepEqual(page.gallery.map((x) => x.path), [a, b]);
  const sess = adminAuth.adminLogin((adminAuth.upsertAdminUser('root', 'pw-pw-pw-pw'), 'root'), 'pw-pw-pw-pw');
  const put = await fetch(`${base}/api/admin/tours/fixme`, {
    method: 'PUT', headers: { origin: 'https://example.test', cookie: `chaacme_admin_session=${sess}`, 'content-type': 'application/json' },
    body: JSON.stringify({ galleryImages: ['الف', 'ب'], galleryPhotos: after1 })
  });
  assert.equal(put.status, 200);
});

test('migration 006 on an old schema without the optional columns does not fail', () => {
  const old = new DatabaseSync(':memory:');
  old.exec(`CREATE TABLE tour_media (id INTEGER PRIMARY KEY, tour_id TEXT, ordinal INTEGER, label TEXT, image_path TEXT);
            INSERT INTO tour_media (tour_id, ordinal, image_path) VALUES ('t', 0, 'images/a/b.jpg'), ('t', 1, '/images/a/c.jpg'), ('t', 2, NULL);`);
  migrations.find((m) => m.id === 6).up(old);
  assert.deepEqual(old.prepare('SELECT image_path FROM tour_media ORDER BY ordinal').all().map((r) => r.image_path), ['/images/a/b.jpg', '/images/a/c.jpg', null]);
});
