import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'chaacme-img-'));
const IMAGES = join(dir, 'images');
Object.assign(process.env, {
  CHAACME_PLATFORM_DB: join(dir, 't.db'), IP_HASH_SALT: 'x'.repeat(24), OTP_PEPPER: 'y'.repeat(24),
  FRONTEND_STATIC_DIR: IMAGES
});
delete process.env.IMAGEMAGICK_BIN;

const images = await import('../server/images.js');
const upload = await import('../server/upload.js');

const hasMagick = (() => { try { execFileSync('convert', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const needsMagick = { skip: hasMagick ? false : 'ImageMagick is not installed' };

const run = (args) => execFileSync('convert', args, { env: { ...process.env, MAGICK_CONFIGURE_PATH: '' } });
const identify = (file, fmt) => execFileSync('identify', ['-format', fmt, file]).toString();
const dims = (file) => identify(file, '%wx%h');

/** A JPEG made by ImageMagick plus a hand-built EXIF block (orientation + GPS), so metadata removal is really tested. */
function jpegWithGps(w, h, orientation = 1) {
  const tmp = join(dir, `src-${Math.random().toString(16).slice(2)}.jpg`);
  run(['-size', `${w}x${h}`, 'gradient:#a84b24-#1f6b78', `jpeg:${tmp}`]);
  const jpg = readFileSync(tmp);
  const le16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
  const le32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
  const entry = (tag, type, count, value) => Buffer.concat([le16(tag), le16(type), le32(count), value]);
  // TIFF: header(8) + IFD0 (2 entries) + GPS IFD (3 entries) + rational data
  const ifd0Off = 8; const ifd0Len = 2 + 2 * 12 + 4; const gpsOff = ifd0Off + ifd0Len; const gpsLen = 2 + 3 * 12 + 4; const dataOff = gpsOff + gpsLen;
  const rat = Buffer.concat([le32(36), le32(1), le32(0), le32(1), le32(0), le32(1)]);
  const tiff = Buffer.concat([
    Buffer.from('II*\0'), le32(ifd0Off),
    le16(2), entry(0x0112, 3, 1, Buffer.concat([le16(orientation), le16(0)])), entry(0x8825, 4, 1, le32(gpsOff)), le32(0),
    le16(3), entry(1, 2, 2, Buffer.from('N\0\0\0')), entry(2, 5, 3, le32(dataOff)), entry(3, 2, 2, Buffer.from('E\0\0\0')), le32(0),
    rat
  ]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([(tiff.length + 8) >> 8, (tiff.length + 8) & 255]), Buffer.from('Exif\0\0'), tiff]);
  return Buffer.concat([jpg.subarray(0, 2), app1, jpg.subarray(2)]);
}

const png = (w, h) => { const f = join(dir, `p-${Math.random().toString(16).slice(2)}.png`); run(['-size', `${w}x${h}`, 'xc:#2f5d46', `png:${f}`]); return readFileSync(f); };

function req(buf, { filename = 'photo.jpg', fields = {} } = {}) {
  const b = '----t' + Math.random().toString(16).slice(2);
  const parts = Object.entries(fields).map(([k, v]) => Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  const head = Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`);
  const r = Readable.from([Buffer.concat([...parts, head, buf, Buffer.from(`\r\n--${b}--\r\n`)])]);
  r.headers = { 'content-type': `multipart/form-data; boundary=${b}` };
  return r;
}
const abs = (publicPath) => join(IMAGES, publicPath.replace(/^\/images\//, ''));

before(() => { mkdirSync(IMAGES, { recursive: true }); });

test('variants: widths 480/960/1600 as WebP and a 1200x630 JPEG, sizes recorded', needsMagick, async () => {
  const r = await upload.handleUpload(req(jpegWithGps(3000, 2000), { fields: { tourId: 'demo' } }));
  assert.equal(r.status, 201);
  assert.match(r.path, /^\/images\/tour-demo\/\d+-[0-9a-f]{12}\.jpg$/);
  assert.equal(r.width, 3000); assert.equal(r.height, 2000);
  const d = images.describeImage(r.path, { alt: 'a', caption: 'c' });
  assert.deepEqual(d.variants.map((v) => v.width), [480, 960, 1600]);
  for (const v of d.variants) {
    assert.match(dims(abs(v.url)), new RegExp(`^${v.width}x${v.height}$`));
    assert.equal(identify(abs(v.url), '%m'), 'WEBP');
  }
  assert.equal(dims(abs(d.og.url)), '1200x630');
  assert.equal(identify(abs(d.og.url), '%m'), 'JPEG');
  assert.deepEqual([d.width, d.height, d.alt, d.caption], [3000, 2000, 'a', 'c']);
});

test('no upscaling: a 700px image gets 480 + its own width, and no OG crop it cannot fill', needsMagick, async () => {
  const r = await upload.handleUpload(req(jpegWithGps(700, 500)));
  const d = images.describeImage(r.path);
  assert.deepEqual(d.variants.map((v) => v.width), [480, 700]);
  assert.equal(d.og, null);
  const files = readdirSync(dirname(abs(r.path)));
  assert.ok(!files.some((f) => f.includes('.w960.') || f.includes('.w1600.')));
  const tiny = await upload.handleUpload(req(png(300, 200)));
  assert.deepEqual(images.describeImage(tiny.path).variants.map((v) => v.width), [300]);
});

test('EXIF/GPS is removed from every variant and from the stored original; orientation is applied', needsMagick, async () => {
  const src = jpegWithGps(2400, 1600, 6);
  const withGps = join(dir, 'with-gps.jpg'); writeFileSync(withGps, src);
  assert.match(execFileSync('identify', ['-verbose', withGps]).toString(), /exif:GPSLatitudeRef: N/);
  const r = await upload.handleUpload(req(src));
  const d = images.describeImage(r.path);
  assert.equal(d.width, 1600); assert.equal(d.height, 2400); // rotated by orientation 6
  for (const f of [abs(r.path), ...d.variants.map((v) => abs(v.url)), abs(d.og.url)]) {
    const meta = execFileSync('identify', ['-verbose', f]).toString();
    assert.ok(!/exif:GPS/i.test(meta), `GPS left in ${f}`);
    assert.ok(!/exif:Orientation/i.test(meta), `orientation tag left in ${f}`);
  }
});

test('disguised and dangerous inputs are rejected; dimensions are capped', needsMagick, async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="/etc/passwd"/></svg>');
  const mvg = Buffer.from('push graphic-context\nviewbox 0 0 10 10\nimage over 0,0 0,0 "label:@/etc/passwd"\npop graphic-context\n');
  for (const [name, body] of [['x.svg', svg], ['x.jpg', svg], ['x.png', mvg], ['x.jpg', Buffer.from('just text')], ['x.jpg', Buffer.alloc(0)]]) {
    const r = await upload.handleUpload(req(body, { filename: name }));
    assert.ok(!r.ok && r.status === 422, `${name}: ${JSON.stringify(r)}`);
  }
  // right magic bytes, wrong content: the pipeline refuses it and the file does not stay on disk
  const before = readdirSync(join(IMAGES, 'uploads'), { withFileTypes: true }).length;
  const fake = await upload.handleUpload(req(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), svg])));
  assert.deepEqual([fake.ok, fake.status, fake.error], [false, 422, 'invalid_image']);
  assert.equal(readdirSync(join(IMAGES, 'uploads'), { withFileTypes: true }).length, before);
  // header declares a huge image (decompression bomb): refused before anything decodes it
  const bomb = png(10, 10); bomb.writeUInt32BE(40000, 16); bomb.writeUInt32BE(40000, 20);
  const big = await upload.handleUpload(req(bomb));
  assert.deepEqual([big.ok, big.status, big.error], [false, 422, 'image_dimensions_too_large']);
  // a real, valid but over-wide image
  const wide = await upload.handleUpload(req(png(17000, 8)));
  assert.deepEqual([wide.ok, wide.status, wide.error], [false, 422, 'image_dimensions_too_large']);
});

test('the user filename never reaches ImageMagick (argv is logged by a wrapper)', needsMagick, async () => {
  const log = join(dir, 'argv.log');
  const wrapper = join(dir, 'wrap.sh');
  writeFileSync(wrapper, `#!/bin/sh\nprintf '%s\\n' "$@" >> '${log}'\nexec convert "$@"\n`);
  chmodSync(wrapper, 0o755);
  process.env.IMAGEMAGICK_BIN = wrapper; images.resetImageTool();
  try {
    const evil = 'evil;$(touch PWNED)`id`-delegate.jpg';
    const r = await upload.handleUpload(req(jpegWithGps(1000, 700), { filename: evil, fields: { tourId: 'demo' } }));
    assert.equal(r.status, 201);
    const argv = readFileSync(log, 'utf8');
    assert.ok(argv.includes('jpeg:'), 'wrapper was used');
    assert.ok(!argv.includes('evil') && !argv.includes('PWNED') && !argv.includes('delegate'), argv.slice(0, 400));
    assert.ok(!existsSync(join(IMAGES, 'tour-demo', 'PWNED')) && !existsSync(join(process.cwd(), 'PWNED')));
  } finally { delete process.env.IMAGEMAGICK_BIN; images.resetImageTool(); }
});

test('ImageMagick missing: the upload still succeeds, the original stays, pages fall back to it, one warning', async () => {
  process.env.IMAGEMAGICK_BIN = join(dir, 'no-such-binary'); images.resetImageTool();
  const warnings = []; const orig = console.warn; console.warn = (m) => warnings.push(String(m));
  try {
    const src = hasMagick ? jpegWithGps(2000, 1000) : Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]);
    const a = await upload.handleUpload(req(src));
    const b = await upload.handleUpload(req(src));
    assert.equal(a.status, 201); assert.equal(b.status, 201);
    assert.ok(existsSync(abs(a.path)));
    const d = images.describeImage(a.path, { alt: 'x' });
    assert.deepEqual(d.variants, []); assert.equal(d.og, null); assert.equal(d.path, a.path);
    assert.equal(warnings.filter((w) => /ImageMagick not found/.test(w)).length, 1);
    assert.equal(await images.imageToolAvailable(), false);
  } finally { console.warn = orig; delete process.env.IMAGEMAGICK_BIN; images.resetImageTool(); }
});

test('pending partner uploads get variants only after approval moves them into the public tree', needsMagick, async () => {
  const slug = 'pend-host';
  const pending = await upload.handlePendingHostUpload(req(jpegWithGps(1800, 1200)), slug);
  assert.equal(pending.status, 201);
  assert.ok(upload.pendingUploadExists(pending.path));
  assert.ok(!existsSync(join(IMAGES, `host-${slug}`)), 'nothing public yet');
  const pub = upload.movePendingUpload(pending.path);
  assert.equal(pub, pending.path.replace('/pending/', '/'));
  for (let i = 0; i < 100 && !images.describeImage(pub).variants.length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(images.describeImage(pub).variants.length >= 3);
});

test('deleting an upload removes its variants and meta', needsMagick, async () => {
  const r = await upload.handleUpload(req(jpegWithGps(2000, 1400), { fields: { tourId: 'demo' } }));
  const folder = dirname(abs(r.path));
  const stem = r.path.split('/').pop().replace(/\.jpg$/, '');
  assert.ok(readdirSync(folder).filter((f) => f.startsWith(stem)).length >= 6);
  upload.deleteUploadedFile(r.path);
  assert.deepEqual(readdirSync(folder).filter((f) => f.startsWith(stem)), []);
});

test('describeImage refuses anything that is not one of our /images paths', () => {
  for (const bad of ['/etc/passwd', '/images/../../etc/passwd', '/images/a/../b.jpg', 'https://evil.example/x.jpg', '//evil/x.jpg', '/images/a b.jpg', null, 5, '/images/']) {
    assert.equal(images.describeImage(bad), null, String(bad));
  }
});

test('backfill script: dry run changes nothing, a real run generates, a second run is a no-op', needsMagick, () => {
  const root = mkdtempSync(join(tmpdir(), 'chaacme-backfill-'));
  mkdirSync(join(root, 'tour-old'), { recursive: true });
  writeFileSync(join(root, 'tour-old', 'legacy.jpg'), jpegWithGps(2000, 1400));
  writeFileSync(join(root, 'tour-old', 'bad name.jpg'), jpegWithGps(100, 100));
  const script = fileURLToPath(new URL('../scripts/backfill-image-variants.mjs', import.meta.url));
  const go = (...a) => execFileSync(process.execPath, [script, ...a], { env: { ...process.env, FRONTEND_STATIC_DIR: root }, encoding: 'utf8' });
  const dry = go('--dry-run');
  assert.match(dry, /would generate: \/images\/tour-old\/legacy\.jpg/);
  assert.match(dry, /DRY RUN/);
  assert.deepEqual(readdirSync(join(root, 'tour-old')).sort(), ['bad name.jpg', 'legacy.jpg']);
  const first = go();
  assert.match(first, /1 generated, 0 already up to date, 0 rejected, 1 skipped \(unsafe name\), 0 failed/);
  assert.ok(existsSync(join(root, 'tour-old', 'legacy.w480.webp')) && existsSync(join(root, 'tour-old', 'legacy.og.jpg')));
  const second = go();
  assert.match(second, /0 generated, 1 already up to date/);
});
