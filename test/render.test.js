import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { request as httpRequest } from 'node:http';

const dir = mkdtempSync(join(tmpdir(), 'chaacme-render-'));
const PORT = 4300 + Math.floor(Math.random() * 400);
const IMAGES = join(dir, 'images');
Object.assign(process.env, {
  CHAACME_PLATFORM_DB: join(dir, 't.db'), IP_HASH_SALT: 'x'.repeat(24), OTP_PEPPER: 'y'.repeat(24),
  FRONTEND_STATIC_DIR: IMAGES, SITE_ORIGIN: 'https://example.test/', PORT: String(PORT), HOST: '127.0.0.1',
  FRONTEND_ORIGIN: 'https://example.test'
});
delete process.env.FRONTEND_INDEX_FILE;

const { server } = await import('../server/index.js');
const db = await import('../server/db.js');
const upload = await import('../server/upload.js');
const adminAuth = await import('../server/adminAuth.js');
const base = `http://127.0.0.1:${PORT}`;

before(async () => { if (!server.listening) await new Promise((r) => server.once('listening', r)); });
after(() => server.close());

const get = async (path, init) => { const res = await fetch(base + path, init); return { res, text: await res.text(), status: res.status }; };
/** Raw request so `..` and %2e are not normalised away by fetch(). */
const rawGet = (path) => new Promise((resolve, reject) => {
  const r = httpRequest({ host: '127.0.0.1', port: PORT, path, method: 'GET' }, (res) => {
    const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
  });
  r.on('error', reject); r.end();
});

// ---- fixtures ---------------------------------------------------------------------------------------------------
const hasMagick = (() => { try { execFileSync('convert', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
let imgCounter = 0;
async function makeImage(tourId, w = 2400, h = 1600) {
  const f = join(dir, `fx-${++imgCounter}.jpg`);
  execFileSync('convert', ['-size', `${w}x${h}`, `gradient:#${(imgCounter * 4000 + 0xa84b24).toString(16).slice(0, 6)}-#1f6b78`, `jpeg:${f}`]);
  const b = '----t' + imgCounter;
  const body = Buffer.concat([Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="tourId"\r\n\r\n${tourId}\r\n--${b}\r\nContent-Disposition: form-data; name="file"; filename="x.jpg"\r\n\r\n`), readFileSync(f), Buffer.from(`\r\n--${b}--\r\n`)]);
  const req = Readable.from([body]); req.headers = { 'content-type': `multipart/form-data; boundary=${b}` };
  const r = await upload.handleUpload(req);
  assert.equal(r.status, 201);
  return r.path;
}
const future = (days) => db.todayIso(new Date(Date.now() + days * 864e5));
const PAYLOAD = '"><img src=x onerror=alert(1)></script><script>alert(2)</script>';

let fullSlug; let person; let place;
before(async () => {
  db.seed();
  const userId = Number(db.db.prepare("INSERT INTO users (phone, first_name, last_name, username) VALUES ('09127654321','Ali','R','render_u')").run().lastInsertRowid);
  const photo = hasMagick ? () => makeImage('full-tour') : async () => null;

  // person + place with every private field filled, so the deep scan has something to catch
  person = db.createHost({ slug: 'coach-r', kind: 'person', displayName: 'آشکان', bio: 'bio', expertise: 'مربی انیمال فلو', photoPath: null,
    instagramHandle: 'coach_r', contactPhone: '09120000099', userId, status: 'active', credentials: 'SECRET-CRED', seekingPlaceTypes: ['SECRET-SEEK'] });
  place = db.createHost({ slug: 'lodge-r', kind: 'place', displayName: 'روستا زندگی', region: 'سه‌هزار، تنکابن', lodgingType: 'اقامتگاه بوم‌گردی',
    amenities: ['سکوی تمرین سرپوشیده', 'حوضچهٔ سنگی'], latitude: 36.123456, longitude: 52.654321, contactPhone: '09120000098', userId, status: 'active',
    capacityGuests: 20, houseRules: 'SECRET-RULES', acceptsExperienceTypes: ['SECRET-ACCEPT'], photoPath: null, bio: null, expertise: null, instagramHandle: null });
  if (hasMagick) {
    db.db.prepare('UPDATE hosts SET photo_path = ? WHERE id = ?').run(await makeImage('hosts', 1600, 1000), place.id);
    db.db.prepare('UPDATE hosts SET photo_path = ? WHERE id = ?').run(await makeImage('hosts', 800, 800), person.id);
  }

  fullSlug = 'full-tour';
  const g = await Promise.all([photo(), photo(), photo(), photo(), photo(), photo(), photo()]);
  db.createTour({
    id: fullSlug, status: 'published', name: 'ریتریت کامل', duration: '۳ روز و ۲ شب', price: 23000000, tags: 'حرکت',
    description: 'توضیح کوتاه', included: 'اقامت · غذا · جلسه‌ها', story: 'داستان این تجربه از زبان چکمه.\n\nپاراگراف دوم.',
    region: 'forest', experienceType: 'ریتریت حرکتی', level: 'مناسب همهٔ سطوح', bringList: 'لباس گرم · کفش راحت', seoDescription: 'توضیح سئو',
    galleryImages: g.map((_, i) => `عکس ${i}`), galleryPhotos: g.map((p) => p),
    highlights: [{ name: 'جلسه‌های انیمال فلو', description: 'روی سکو', image: g[1], imageAlt: 'سکو', imageCaption: 'زیرنویس' }, { name: 'سفرهٔ محلی' }],
    itinerary: [
      { time: 'روز اول', title: 'رسیدن و آشنایی', description: 'جزئیات روز اول', images: [{ path: g[2], alt: 'روز اول', caption: 'ورود' }] },
      { time: '', title: 'حرکت و جنگل', description: 'جزئیات روز دوم', images: [] }
    ]
  });
  if (hasMagick) {
    const rows = db.db.prepare('SELECT id FROM tour_media WHERE tour_id = ? ORDER BY ordinal').all(fullSlug);
    db.updateTourMediaMeta(fullSlug, rows[0].id, { alt: 'جلسهٔ انیمال فلو روی سکوی چوبی', caption: 'روی سکو' });
  }
  db.db.prepare("UPDATE hosts SET verified_at = datetime('now') WHERE id IN (?, ?)").run(person.id, place.id);
  db.setTourHosts(fullSlug, [{ hostId: person.id, role: 'lead' }, { hostId: place.id, role: 'venue' }]);
  db.addTourDate(fullSlug, { label: 'اجرای اول', capacity: 14, startsOn: future(30), endsOn: future(32) });
  db.addTourDate(fullSlug, { label: 'اجرای دوم', capacity: 14, startsOn: future(60) });
  const full = db.addTourDate(fullSlug, { label: 'اجرای پر', capacity: 5, startsOn: future(90) });
  db.updateTourDate(full.id, { closed: true });
  for (const [name, rating, body] of [['سارا م.', 5, 'عالی بود'], ['رضا ک.', 4, 'خیلی خوب']]) {
    const rv = db.createReview({ tourId: fullSlug, userId, displayName: name, rating, body });
    db.setReviewStatus(rv.id, 'published');
  }
  db.createReview({ tourId: fullSlug, userId, displayName: 'PENDING-NAME', rating: 1, body: 'PENDING-BODY' }); // never public

  db.createTour({ id: 'minimal-tour', status: 'published', name: 'تجربهٔ کمینه' });
  db.addTourDate('minimal-tour', { label: 'تاریخ', capacity: 4, startsOn: future(10) });
  db.createTour({ id: 'draft-tour', status: 'draft', name: 'پیش‌نویس' });
  db.createTour({ id: 'archived-tour', status: 'archived', name: 'بایگانی' });
});

const textOf = (htmlDoc) => htmlDoc
  .replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&quot;|&#39;|&amp;|&lt;|&gt;/g, ' ');

test('full tour: every block is rendered, with correct meta, OG image and structure', async () => {
  const { res, text, status } = await get(`/tour/${fullSlug}`);
  assert.equal(status, 200);
  assert.match(res.headers.get('content-type'), /text\/html; charset=utf-8/);
  for (const needle of [
    '<title>ریتریت کامل — CHAACME</title>', '<link rel="canonical" href="https://example.test/tour/full-tour">',
    '<meta name="description" content="توضیح سئو">', '<meta property="og:title" content="ریتریت کامل — CHAACME">',
    'ck-stamp ck-stamp--forest', 'جنگل شمال', 'ریتریت حرکتی', '<h1 class="tp-title">ریتریت کامل</h1>',
    'با <b>آشکان</b> در <b>روستا زندگی</b>', 'سه‌هزار، تنکابن', 'طراحی و هماهنگی: چکمه',
    'tp-facts', '۳ روز و ۲ شب', 'مناسب همهٔ سطوح', '۱۴ نفر',
    'داستان این تجربه', 'پاراگراف دوم.', 'جلسه‌های انیمال فلو', 'سفرهٔ محلی',
    'برنامهٔ سفر', 'رسیدن و آشنایی', 'روز اول', 'روز ۲', 'tp-days', 'tp-acc',
    'محل برگزاری', 'href="/host/lodge-r"', 'تأییدشده', 'سکوی تمرین سرپوشیده',
    'برگزارکنندگان', 'href="/host/coach-r"', 'مربی انیمال فلو', 'برگزارکننده',
    'نظر مسافران', 'سارا م.', 'رضا ک.', 'عالی بود', 'تجربه‌های دیگر',
    'شرایط', 'چه چیزهایی در هزینه است', 'چه با خودم بیاورم', 'لباس گرم',
    'id="booking"', 'data-booking', 'data-tour="full-tour"', '۲۳٬۰۰۰٬۰۰۰', 'تومان', 'انتخاب تاریخ', 'رزرو این تجربه', 'پرداخت امن با زرین‌پال',
    'tp-sticky', 'data-jump-booking', 'tp-hero__tools'
  ]) assert.ok(text.includes(needle), `missing: ${needle}`);
  assert.ok(!text.includes('PENDING-NAME') && !text.includes('PENDING-BODY'), 'unpublished review leaked');
  // editions: Jalali range, the closed one disabled and marked full
  assert.match(text, /<b>[۰-۹]+ تا [۰-۹]+ \S+ ۱۴۰[۰-۹]<\/b>/);
  assert.match(text, /tp-ed tp-ed--full[^>]*>[\s\S]*?ck-badge--hidden">تکمیل/);
  assert.match(text, /<input type="radio" name="edition" value="\d+" data-available="14" checked>/);
  if (hasMagick) {
    assert.match(text, /<meta property="og:image" content="https:\/\/example\.test\/images\/tour-full-tour\/[^"]+\.og\.jpg">/);
    assert.match(text, /srcset="[^"]*\.w480\.webp 480w, [^"]*\.w960\.webp 960w, [^"]*\.w1600\.webp 1600w"/);
    assert.match(text, /<img src="[^"]+\.w1600\.webp" srcset=[^>]* width="2400" height="1600" loading="eager" decoding="async" fetchpriority="high" alt="جلسهٔ انیمال فلو روی سکوی چوبی">/);
    assert.ok((text.match(/class="tp-hero__tile"/g) || []).length === 5, 'mosaic shows 1 large + 4');
    assert.match(text, /همهٔ عکس‌ها \(۷\)/);
    assert.ok((text.match(/data-lb /g) || []).length === 7, 'all seven photos are lightbox entries');
    assert.match(text, /tp-hl--scroll/);
  }
  // no external hosts anywhere in the page's own resources
  assert.ok(!/(?:src|href)="https?:\/\/(?!example\.test|instagram\.com)/.test(text), 'external resource host');
  assert.ok(!/fonts\.googleapis|gstatic/.test(text));
  // every <img> has alt
  for (const tag of text.match(/<img\b[^>]*>/g) || []) assert.match(tag, /\balt="[^"]/, tag);
});

test('minimal tour (title + one edition): no empty blocks, no placeholder text', async () => {
  const { text, status } = await get('/tour/minimal-tour');
  assert.equal(status, 200);
  const visible = textOf(text);
  assert.ok(!/undefined|null|NaN|\[|\]|\{|\}/.test(visible), `placeholder in: ${visible.replace(/\s+/g, ' ').slice(0, 600)}`);
  // the one fact a bare tour still has is its edition's capacity; nothing else
  assert.equal((text.match(/class="tp-fact"/g) || []).length, 1);
  assert.ok(text.includes('<div class="tp-fact__k">ظرفیت هر اجرا</div><div class="tp-fact__v">۴ نفر</div>'));
  const own = text.slice(0, text.indexOf('tp-related')); // the related-cards row legitimately shows other tours' stamps
  for (const absent of ['tp-hero', 'tp-story', 'داستان این تجربه', 'برنامهٔ سفر', 'محل برگزاری', 'برگزارکنندگان', 'tp-hl', 'در این تجربه', 'ck-stamp', 'ck-chip', 'شرایط', 'تجربه‌های دیگر‌‌', 'tp-note', 'tp-days', 'tp-acc']) {
    if (absent === 'تجربه‌های دیگر‌‌') continue;
    assert.ok(!own.includes(absent), `unexpected block: ${absent}`);
  }
  assert.ok(text.includes('<h1 class="tp-title">تجربهٔ کمینه</h1>'));
  assert.ok(text.includes('<p class="tp-pair">طراحی چکمه</p>'));
  assert.ok(text.includes('هنوز نظری ثبت نشده'), 'reviews show the designed empty state');
  assert.ok(text.includes('id="booking"') && !text.includes('data-booking'));
  // each section heading is followed by content: no <h2> immediately closed by </section>
  assert.ok(!/<h2[^>]*>[^<]*<\/h2>\s*<\/section>/.test(text));
  // meta description: no description anywhere -> the tag is simply absent, never empty
  assert.ok(!/<meta name="description"/.test(text));
  // no price -> no price block, button explains why booking is not possible
  assert.ok(text.includes('قیمت به‌زودی اعلام می‌شود'));
  assert.ok(!text.includes('data-submit'));
});

test('booking card states: full, no dates, coming soon', async () => {
  db.createTour({ id: 'full-edition', status: 'published', name: 'تکمیل', price: 5000000 });
  const e = db.addTourDate('full-edition', { label: 'پر', capacity: 2, startsOn: future(5) });
  db.db.prepare('UPDATE tour_dates SET seats_taken = 2 WHERE id = ?').run(e.id);
  db.createTour({ id: 'no-edition', status: 'published', name: 'بدون تاریخ', price: 5000000 });
  const full = (await get('/tour/full-edition')).text;
  assert.ok(full.includes('ظرفیت تکمیل است') && !full.includes('data-submit') && full.includes('تکمیل'));
  assert.ok(!full.includes('data-jump-booking'));
  const none = (await get('/tour/no-edition')).text;
  assert.ok(none.includes('تاریخ بعدی اعلام می‌شود') && !none.includes('data-submit'));
  const soon = (await get('/tour/next-experience')).text; // seeded coming_soon tour
  assert.ok(soon.includes('تاریخ بعدی اعلام می‌شود') && !soon.includes('data-submit'));
  assert.ok(!/NaN|undefined|null/.test(textOf(soon)));
});

test('hidden, archived, unknown and malformed tours: 404 in the new design, no tour tags', async () => {
  for (const slug of ['draft-tour', 'archived-tour', 'does-not-exist', 'Bad_Slug', 'a--b']) {
    const { res, text, status } = await get(`/tour/${slug}`);
    assert.equal(status, 404, slug);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.ok(text.includes('این تجربه پیدا نشد') && text.includes('ck-site-header') && text.includes('/assets/chaacme.css?v='), slug);
    assert.ok(!text.includes('id="page-tour"') && !text.includes('rel="canonical"') && text.includes('noindex'), slug);
    assert.ok(!text.includes('پیش‌نویس') && !text.includes('بایگانی'));
  }
  assert.equal((await get(`/tour/${fullSlug}`, { method: 'POST' })).status, 404);
  const head = await fetch(`${base}/tour/${fullSlug}`, { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
});

test('XSS: payloads in every text field, alt and caption render as text in the page and in OG/meta tags', async () => {
  const slug = 'xss-tour';
  const img = hasMagick ? await makeImage(slug) : null;
  const P = PAYLOAD;
  const hostXss = db.createHost({ slug: 'xss-host', kind: 'person', displayName: `H${P}`, expertise: `E${P}`, bio: null, photoPath: null,
    instagramHandle: null, contactPhone: null, userId: null, status: 'active' });
  const placeXss = db.createHost({ slug: 'xss-place', kind: 'place', displayName: `V${P}`, region: `R${P}`, lodgingType: `L${P}`, amenities: [`A${P}`],
    photoPath: null, bio: null, expertise: null, instagramHandle: null, contactPhone: null, userId: null, status: 'active' });
  db.createTour({
    id: slug, status: 'published', name: `N${P}`, duration: `D${P}`, price: 1000, tags: `T${P}`, description: `Desc${P}`,
    included: `I${P}`, story: `S${P}`, region: 'desert', experienceType: `X${P}`, level: `Lv${P}`, bringList: `B${P}`, seoDescription: `SEO${P}`,
    galleryImages: [`G${P}`], galleryPhotos: [img],
    highlights: [{ name: `HN${P}`, description: `HD${P}`, image: img, imageAlt: `HA${P}`, imageCaption: `HC${P}` }],
    itinerary: [{ time: `IT${P}`, title: `IL${P}`, description: `ID${P}`, images: img ? [{ path: img, alt: `IA${P}`, caption: `IC${P}` }] : [] }]
  });
  if (img) { const row = db.db.prepare('SELECT id FROM tour_media WHERE tour_id = ?').get(slug); db.updateTourMediaMeta(slug, row.id, { alt: `GA${P}`, caption: `GC${P}` }); }
  db.setTourHosts(slug, [{ hostId: hostXss.id, role: 'lead' }, { hostId: placeXss.id, role: 'venue' }]);
  db.addTourDate(slug, { label: `E${P}`, capacity: 5 });
  const userId = db.db.prepare('SELECT id FROM users LIMIT 1').get().id;
  const rv = db.createReview({ tourId: slug, userId, displayName: `RN${P}`, rating: 3, body: `RB${P}` });
  db.setReviewStatus(rv.id, 'published');

  const { text, status } = await get(`/tour/${slug}`);
  assert.equal(status, 200);
  assert.ok(!text.includes('<img src=x'), 'raw <img> from a payload');
  assert.ok(!text.includes('<script>alert'), 'raw <script> from a payload');
  assert.equal((text.match(/<script\b/g) || []).length, 2, 'only the import map and the island script');
  for (const tag of text.match(/<[a-zA-Z][^>]*>/g) || []) assert.ok(!/\sonerror\s*=/i.test(tag.replace(/"[^"]*"/g, '""')), `a tag carrying onerror: ${tag.slice(0, 120)}`);
  const esc = '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;&lt;/script&gt;&lt;script&gt;alert(2)&lt;/script&gt;';
  for (const marker of ['N', 'D', 'S', 'X', 'Lv', 'B', 'HN', 'HD', 'IL', 'ID', 'H', 'V', 'R', 'L', 'A', 'RN', 'RB']) {
    assert.ok(text.includes(`${marker}${esc}`), `field ${marker} not rendered as escaped text`);
  }
  assert.ok(text.includes(`<title>N${esc} — CHAACME</title>`));
  assert.ok(text.includes(`<meta property="og:title" content="N${esc} — CHAACME">`));
  assert.ok(text.includes(`<meta name="twitter:title" content="N${esc} — CHAACME">`));
  assert.ok(text.includes(`<meta name="description" content="SEO${esc}">`));
  assert.ok(text.includes(`<meta property="og:description" content="SEO${esc}">`));
  if (img) for (const marker of ['GA', 'GC', 'HA', 'HC', 'IA', 'IC']) assert.ok(text.includes(`${marker}${esc}`), `image field ${marker}`);
  // the view-model JSON carries the raw text (JSON-escaped), never HTML
  const api = await get(`/api/pages/tour/${slug}`);
  assert.equal(JSON.parse(api.text).page.name, `N${P}`);
});

test('view model: public projection only, deep scan for forbidden keys and values', async () => {
  const { res, text, status } = await get(`/api/pages/tour/${fullSlug}`);
  assert.equal(status, 200);
  assert.match(res.headers.get('cache-control'), /public, max-age=60, stale-while-revalidate=300/);
  const { page } = JSON.parse(text);
  const FORBIDDEN_KEY = /user_?id|owner|contact|phone|latitude|longitude|approximate|^lat$|^lng$|coord|credentials|seeking|accepts|house_?rules|capacity_?guests|email|password|token|ip_?hash|instagram|bio$|admin|verified_?at|created_?at$|^id$/i;
  const walk = (v, path) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (v && typeof v === 'object') {
      for (const [k, x] of Object.entries(v)) {
        const here = `${path}.${k}`;
        if (FORBIDDEN_KEY.test(k) && !(k === 'id' && /^\.editions\[\d+\]\.id$/.test(here)) && !(k === 'createdAt' && /reviews\.items/.test(path))) assert.fail(`forbidden key ${here}`);
        walk(x, here);
      }
    }
  };
  walk(page, '');
  for (const secret of ['SECRET-CRED', 'SECRET-SEEK', 'SECRET-RULES', 'SECRET-ACCEPT', '09120000099', '09120000098', '09127654321', '36.12', '52.65', 'PENDING-BODY']) {
    assert.ok(!text.includes(secret), `value leaked: ${secret}`);
  }
  assert.equal(page.slug, fullSlug);
  assert.equal(page.people[0].slug, 'coach-r'); assert.equal(page.people[0].role, 'lead');
  assert.equal(page.venue.slug, 'lodge-r');
  assert.equal(page.related.length, 3);
  assert.ok(page.related.every((r) => r.slug !== fullSlug));
  assert.equal(page.reviews.count, 2);
  assert.equal(page.editions.length, 3);
  assert.deepEqual(Object.keys(page.editions[0]).sort(), ['available', 'capacity', 'endsOn', 'full', 'id', 'label', 'startsOn', 'status']);
  assert.equal((await get('/api/pages/tour/draft-tour')).status, 404);
  assert.equal((await get('/api/pages/tour/nope')).status, 404);
});

test('caching: HTML 60s + stale-while-revalidate, versioned assets immutable, ETag revalidation', async () => {
  const page = await get(`/tour/${fullSlug}`);
  assert.equal(page.res.headers.get('cache-control'), 'public, max-age=60, stale-while-revalidate=300');
  assert.ok(!page.res.headers.get('set-cookie'));
  const etag = page.res.headers.get('etag');
  const again = await fetch(`${base}/tour/${fullSlug}`, { headers: { 'if-none-match': etag } });
  assert.equal(again.status, 304);
  const css = /href="(\/assets\/chaacme\.css\?v=[0-9a-f]+)"/.exec(page.text)[1];
  const cssRes = await get(css);
  assert.equal(cssRes.status, 200);
  assert.match(cssRes.res.headers.get('content-type'), /text\/css/);
  assert.equal(cssRes.res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const island = /src="(\/assets\/js\/tour-island\.js\?v=[0-9a-f]+)"/.exec(page.text)[1];
  assert.equal((await get(island)).res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  const fmt = JSON.parse(/<script type="importmap">(.*?)<\/script>/.exec(page.text)[1]).imports['/assets/js/shared/format.js'];
  assert.match(fmt, /^\/assets\/js\/shared\/format\.js\?v=[0-9a-f]+$/);
  const font = await get('/assets/fonts/vazirmatn-5.3.0-arabic.woff2');
  assert.equal(font.res.headers.get('content-type'), 'font/woff2');
  assert.equal(font.res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal((await get('/assets/js/shared/format.js')).res.headers.get('cache-control'), 'public, max-age=300');
  assert.match(css.slice(css.indexOf('?v=')), /^\?v=[0-9a-f]{10}$/);
  const sheet = cssRes.text;
  assert.ok(/@font-face[^}]*Vazirmatn[^}]*font-display: swap/.test(sheet) && !/https?:\/\//.test(sheet.replace(/\/\*[\s\S]*?\*\//g, '')), 'no external hosts in the stylesheet');
});

test('/assets and /images serve only allow-listed files, never outside their roots', async () => {
  for (const bad of ['/assets/../server/db.js', '/assets/%2e%2e/server/db.js', '/assets/..%2fserver%2fdb.js', '/assets/js/../../server/db.js', '/assets/fonts/README.md',
    '/assets/fonts/LICENSE-fraunces.txt', '/assets/js/%00.js', '/assets/', '/assets/nope.css', '/assets//etc/passwd']) {
    const r = await rawGet(bad);
    assert.notEqual(r.status, 200, bad);
    assert.ok(!/DatabaseSync|require\(|root:/.test(r.text), bad);
  }
  assert.equal((await rawGet('/images/x.jpg')).status, 404); // SERVE_STATIC is not set: nginx owns /images in production
});

test('/images (dev/test static mode) is allow-listed and traversal-safe; off by default', async () => {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(join(IMAGES, 'tour-x'), { recursive: true });
  writeFileSync(join(IMAGES, 'tour-x', 'a.w480.webp'), 'webp-bytes');
  writeFileSync(join(IMAGES, 'tour-x', 'a.meta.json'), '{}');
  writeFileSync(join(dir, 'outside.jpg'), 'outside');
  assert.equal((await rawGet('/images/tour-x/a.w480.webp')).status, 404, 'off unless SERVE_STATIC=1');
  process.env.SERVE_STATIC = '1';
  try {
    const ok = await rawGet('/images/tour-x/a.w480.webp');
    assert.equal(ok.status, 200); assert.equal(ok.headers['content-type'], 'image/webp');
    assert.equal(ok.headers['cache-control'], 'public, max-age=31536000, immutable');
    for (const bad of ['/images/tour-x/a.meta.json', '/images/../outside.jpg', '/images/%2e%2e/outside.jpg', '/images/tour-x/%2e%2e/%2e%2e/outside.jpg',
      '/images/tour-x/..%2f..%2foutside.jpg', '/images/tour-x/a.w480.webp%00.jpg', '/images/', '/images//etc/passwd', '/images/tour-x/.a.w480.webp.partial']) {
      const r = await rawGet(bad);
      assert.notEqual(r.status, 200, bad); assert.ok(!r.text.includes('outside') && !r.text.includes('root:'), bad);
    }
  } finally { delete process.env.SERVE_STATIC; }
});

test('admin save validates the new tour fields and keeps alt/caption across a gallery replace', async () => {
  const admin = adminAuth.adminLogin((adminAuth.upsertAdminUser('root', 'pw-pw-pw-pw'), 'root'), 'pw-pw-pw-pw');
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { origin: 'https://example.test', cookie: `chaacme_admin_session=${admin}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const id = 'admin-tour';
  assert.equal((await call('POST', '/api/admin/tours', { id, name: 'ادمین', status: 'published' })).status, 201);
  const bad = [
    { region: 'mars' }, { story: 'x'.repeat(1501) }, { experienceType: 'x'.repeat(61) }, { level: 5 }, { seoDescription: 'x'.repeat(161) },
    { bringList: 'x'.repeat(601) }, { included: 'x'.repeat(601) }, { galleryPhotos: ['javascript:alert(1)'] }, { galleryPhotos: ['/images/host-a/pending/x.jpg'] },
    { highlights: [{ name: 'h', image: 'https://evil.example/x.jpg' }] }, { highlights: [{ name: 'h', imageAlt: 'x'.repeat(161) }] },
    { highlights: [{ name: 'h', imageCaption: 'x'.repeat(121) }] },
    { itinerary: [{ title: 't', images: Array.from({ length: 7 }, () => ({ path: '/images/a/b.jpg' })) }] },
    { itinerary: [{ title: 't', images: [{ path: '/images/a/b.jpg', alt: 'x'.repeat(161) }] }] },
    { itinerary: [{ title: 't', images: [{ path: '//evil/x.jpg' }] }] }
  ];
  for (const patch of bad) {
    const r = await call('PUT', `/api/admin/tours/${id}`, patch);
    assert.equal(r.status, 422, JSON.stringify(patch).slice(0, 80));
  }
  const ok = await call('PUT', `/api/admin/tours/${id}`, {
    region: 'sea', story: ' نوشته ', experienceType: 'x', level: '', bringList: 'b', seoDescription: 'd',
    galleryImages: ['a', 'b'], galleryPhotos: ['/images/tour-admin-tour/a.jpg', '/images/tour-admin-tour/b.jpg'], galleryAlt: ['الف', 'ب'], galleryCaption: ['ک۱', null],
    highlights: [{ name: 'h', image: '/images/tour-admin-tour/a.jpg', imageAlt: 'alt', imageCaption: 'cap' }],
    itinerary: [{ title: 't', images: Array.from({ length: 6 }, (_, i) => ({ path: `/images/tour-admin-tour/i${i}.jpg`, alt: `a${i}` })) }]
  });
  assert.equal(ok.status, 200);
  let t = (await call('GET', `/api/admin/tours/${id}`)).data.tour;
  assert.deepEqual([t.region, t.story, t.level, t.experienceType], ['sea', 'نوشته', null, 'x']);
  assert.deepEqual(t.galleryMedia.map((m) => [m.alt, m.caption]), [['الف', 'ک۱'], ['ب', null]]);
  assert.equal(t.highlights[0].imageAlt, 'alt');
  assert.equal(t.itinerary[0].images.length, 6);
  // replace-all of the photo list (what "add photo" does) keeps each image's alt and caption
  await call('PUT', `/api/admin/tours/${id}`, { galleryImages: ['a', 'b', 'c'], galleryPhotos: ['/images/tour-admin-tour/a.jpg', '/images/tour-admin-tour/b.jpg', '/images/tour-admin-tour/c.jpg'] });
  t = (await call('GET', `/api/admin/tours/${id}`)).data.tour;
  assert.deepEqual(t.galleryMedia.map((m) => [m.alt, m.caption]), [['الف', 'ک۱'], ['ب', null], [null, null]]);
  // per-image alt/caption endpoint + reorder: first = cover
  const [m1, m2] = t.galleryMedia;
  assert.equal((await call('PUT', `/api/admin/tours/${id}/gallery/${m2.id}`, { alt: 'جدید', caption: 'ک' })).status, 200);
  assert.equal((await call('PUT', `/api/admin/tours/${id}/gallery/${m2.id}`, { alt: 'x'.repeat(161) })).status, 422);
  assert.equal((await call('PUT', `/api/admin/tours/${id}/gallery/999999`, { alt: 'x' })).status, 404);
  assert.equal((await call('PUT', `/api/admin/tours/${id}/gallery/reorder`, { order: [m2.id, t.galleryMedia[2].id, m1.id] })).status, 200);
  const page = (await get(`/api/pages/tour/${id}`)).text;
  const model = JSON.parse(page).page;
  assert.deepEqual(model.gallery.map((g) => g.path), ['/images/tour-admin-tour/b.jpg', '/images/tour-admin-tour/c.jpg', '/images/tour-admin-tour/a.jpg']);
  assert.equal(model.cover.alt, 'جدید');
  assert.equal(model.region.key, 'sea');
  // an unauthenticated caller cannot use the new endpoint
  assert.equal((await fetch(`${base}/api/admin/tours/${id}/gallery/${m2.id}`, { method: 'PUT', headers: { origin: 'https://example.test', 'content-type': 'application/json' }, body: '{}' })).status, 401);
});
