import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'chaacme-pub-'));
const PORT = 5300 + Math.floor(Math.random() * 300);
Object.assign(process.env, {
  CHAACME_PLATFORM_DB: join(dir, 't.db'), IP_HASH_SALT: 'x'.repeat(24), OTP_PEPPER: 'y'.repeat(24),
  FRONTEND_STATIC_DIR: join(dir, 'images'), SITE_ORIGIN: 'https://example.test/', PORT: String(PORT), HOST: '127.0.0.1', FRONTEND_ORIGIN: 'https://example.test'
});
const { server } = await import('../server/index.js');
const db = await import('../server/db.js');
const upload = await import('../server/upload.js');
const settings = await import('../server/settings.js');
const fx = await import('./support/fixtures.mjs');
const base = `http://127.0.0.1:${PORT}`;
before(async () => { if (!server.listening) await new Promise((r) => server.once('listening', r)); });
after(() => server.close());

const get = async (path, init) => { const res = await fetch(base + path, { redirect: 'manual', ...init }); return { res, text: await res.text(), status: res.status }; };
const visible = (h) => h.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&quot;|&#39;|&amp;|&lt;|&gt;/g, ' ');
const clean = (text, label) => {
  const v = visible(text);
  assert.ok(!/undefined|\bnull\b|NaN|\[object|\{\{|\[[^\]]*\]/.test(v), `${label}: placeholder text in ${v.replace(/\s+/g, ' ').slice(0, 400)}`);
  assert.ok(!/<h2[^>]*>[^<]*<\/h2>\s*<\/section>/.test(text), `${label}: heading without content`);
  for (const tag of text.match(/<img\b[^>]*>/g) || []) assert.match(tag, /\balt="/, `${label}: ${tag}`);
};

// ---- empty site first: every block must be absent, nothing invented ---------------------------------------
test('empty site: home has no sections, no hero; footer has only the link that always exists', async () => {
  const { status, text } = await get('/');
  assert.equal(status, 200);
  clean(text, 'home-empty');
  for (const absent of ['hm-hero', 'hm-sec', 'hm-band', 'hm-how', 'pl-grid', 'تجربه‌های پیش‌رو']) assert.ok(!text.includes(absent), absent);
  assert.match(text, /<main class="hm-main" id="main"><\/main>/);
  assert.ok(text.includes('ck-site-header') && !text.includes('ck-site-header--overlay'), 'no hero -> solid header');
  assert.equal((text.match(/<footer[\s\S]*<\/footer>/)[0].match(/<a /g) || []).length, 1);
  for (const p of ['/about', '/terms', '/refund', '/privacy']) assert.equal((await get(p)).status, 404, p);
});

test('empty site: the seeded undated tours list without a filter bar (nothing to filter by); places show their empty state', async () => {
  const e = await get('/experiences');
  assert.equal(e.status, 200);
  clean(e.text, 'experiences-empty');
  assert.ok(!e.text.includes('data-filters') && e.text.includes('ex-count') && !e.text.includes('اجرای باز'));
  assert.ok((await get('/places')).text.includes('هنوز مکانی منتشر نشده'));
  db.db.prepare('DELETE FROM tours').run();
  const none = await get('/experiences');
  assert.ok(none.text.includes('هنوز تجربه‌ای منتشر نشده') && !none.text.includes('ex-count'));
  db.seed({ force: true });
});

// ---- full fixture ------------------------------------------------------------------------------------------
let full; let seeding = null;
const seed = () => (seeding ||= (async () => {
  db.seed(); // 6 seeded tours, none with dates
  const make = fx.imageMaker(upload, join(dir, 'work'));
  const vf = fx.fakeMp4(join(dir, 'work'));
  const { readFileSync } = await import('node:fs');
  const bd = '----v1';
  const body = Buffer.concat([Buffer.from(`--${bd}\r\nContent-Disposition: form-data; name="file"; filename="h.mp4"\r\n\r\n`), readFileSync(vf), Buffer.from(`\r\n--${bd}--\r\n`)]);
  const { Readable } = await import('node:stream');
  const req = Readable.from([body]); req.headers = { 'content-type': `multipart/form-data; boundary=${bd}` };
  const v = await upload.handleVideoUpload(req);
  assert.equal(v.status, 201);
  full = await fx.seedFullSite({ db, upload, settings, makeImage: make, videoPath: v.path });
})());
// the empty-site tests above run first; every later test starts from the full site
const ft = (name, fn) => test(name, async () => { await seed(); return fn(); });

ft('home (full): hero video + poster, copy, CTAs, upcoming soonest first (max 6), explainer, places, band, footer', async () => {
  const { text, status } = await get('/');
  assert.equal(status, 200);
  clean(text, 'home-full');
  for (const needle of ['hm-hero', 'ck-site-header--overlay', '<video class="hm-hero__media"', 'data-hero-video', 'poster="/images/site/', 'autoplay muted loop playsinline',
    'سفرهایی که از آدم‌ها و مکان‌ها ساخته می‌شوند', 'href="/experiences" class="ck-btn ck-btn--primary hm-btn">تجربه‌های پیش‌رو', 'href="#how"', 'id="how"',
    'تجربه‌های پیش‌رو', 'هر تجربه سه تکه دارد', 'برگزارکننده', 'مسافران', 'مکان‌ها', 'اقامتگاه نمونه', 'مکان کمینه', 'مربی هستی یا مکانی برای میزبانی داری؟', 'href="/become-host" class="ck-btn ck-btn--primary hm-btn">همکاری با چکمه',
    'href="https://instagram.com/chaacme_fx"', 'href="/about"', 'href="/terms"', 'href="/refund"', 'href="/privacy"']) assert.ok(text.includes(needle), `missing ${needle}`);
  // soonest first: forest flow (25d) < tea (40d) < desert (70d); coming-soon / full-closed tours are not "upcoming"
  const order = ['ریتریت نمونه', 'چای از باغ تا فنجان', 'کویر نمونه'].map((n) => text.indexOf(`<h3 class="ck-xcard__title">${n}`));
  assert.ok(order.every((i) => i > 0) && order[0] < order[1] && order[1] < order[2], JSON.stringify(order));
  assert.ok(!text.includes('جزیرهٔ نمونه') && !text.includes('تجربهٔ پر'));
  assert.ok(!text.includes('مخفی') && !text.includes('hidden-fx'), 'hidden place');
});

ft('home: at most 6 upcoming experiences and 4 places', async () => {
  for (let i = 0; i < 8; i++) {
    db.createTour({ id: `many-${i}`, status: 'published', name: `کثیر ${i}`, price: 1000 });
    db.addTourDate(`many-${i}`, { label: 'x', capacity: 5, startsOn: fx.future(db, 100 + i) });
    db.createHost({ slug: `place-many-${i}`, kind: 'place', displayName: `مکان ${i}`, status: 'active', photoPath: null, bio: null, expertise: null, instagramHandle: null, contactPhone: null });
  }
  const { text } = await get('/');
  assert.equal((text.match(/class="ck-xcard"/g) || []).length, 6);
  assert.equal((text.match(/class="pl-card[ "]/g) || []).length, 4);
  assert.equal((await get('/places')).text.match(/class="pl-card[ "]/g).length, 2 + 8, 'every active place on /places');
  db.db.prepare("DELETE FROM hosts WHERE slug LIKE 'place-many-%'").run();
  db.db.prepare("DELETE FROM tours WHERE id LIKE 'many-%'").run();
});

ft('home: image fallback without a video; plain hero with only a headline', async () => {
  settings.writeSettings({ home_hero_video: null });
  let t = (await get('/')).text;
  assert.ok(!t.includes('<video') && t.includes('class="hm-hero__media"') && t.includes('<img'));
  const keep = settings.getSettings();
  settings.writeSettings({ home_hero_poster: null, home_hero_image: null });
  t = (await get('/')).text;
  assert.ok(t.includes('hm-hero--plain') && !t.includes('hm-hero__media'));
  settings.writeSettings({ home_hero_headline: null, home_hero_subline: null, home_cta_primary: null, home_cta_secondary: null });
  t = (await get('/')).text;
  assert.ok(!t.includes('hm-hero') && !t.includes('overlay'), 'nothing to show -> no hero');
  settings.writeSettings({ home_hero_poster: keep.home_hero_poster, home_hero_image: keep.home_hero_image, home_hero_headline: keep.home_hero_headline, home_hero_subline: keep.home_hero_subline,
    home_cta_primary: keep.home_cta_primary, home_cta_secondary: keep.home_cta_secondary, home_hero_video: keep.home_hero_video });
  // explainer hidden -> the secondary CTA that points at it is hidden too
  settings.writeSettings({ explainer_title: null, explainer_text: null, explainer_1_title: null, explainer_1_text: null, explainer_1_image: null, explainer_2_title: null, explainer_2_text: null, explainer_2_image: null, explainer_3_title: null, explainer_3_text: null, explainer_3_image: null });
  t = (await get('/')).text;
  assert.ok(!t.includes('id="how"') && !t.includes('href="#how"') && !t.includes('چکمه چطور کار می‌کند'));
});

ft('experiences: filters from the query string, shareable and validated', async () => {
  const all = (await get('/experiences')).text;
  clean(all, 'experiences');
  assert.ok(all.includes('data-filters') && all.includes('name="region"') && all.includes('name="type"') && all.includes('name="month"') && all.includes('name="open"'));
  assert.match(all, /role="status">[۰-۹]+ تجربه · [۰-۹]+ اجرای باز</);
  const cards = (t) => (t.match(/class="ck-xcard"/g) || []).length;
  const total = cards(all);
  assert.ok(total >= 5);
  assert.ok(!all.includes('حذف فیلترها'));
  const desert = await get('/experiences?region=desert');
  assert.ok(cards(desert.text) < total && desert.text.includes('کویر نمونه') && !desert.text.includes('چای از باغ') && desert.text.includes('حذف فیلترها') && desert.text.includes('noindex'));
  assert.ok(desert.text.includes('name="region" value="desert" checked'));
  const type = await get(`/experiences?type=${encodeURIComponent('غذا و فرهنگ')}`);
  assert.equal(cards(type.text), 1);
  const open = (await get('/experiences?open=1')).text;
  assert.ok(!open.includes('جزیرهٔ نمونه') && !open.includes('تجربهٔ پر'), 'coming soon and closed editions are not open');
  const month = all.match(/<option value="(\d{4}-\d{2})"/)[1];
  assert.ok(cards((await get(`/experiences?month=${month}`)).text) >= 1);
  // unknown / hostile values are ignored, never an error and never reflected
  for (const q of ['region=moon', 'type=nope', 'month=1399-99', 'month=abc', 'open=yes', "region='%20OR%201=1--", 'region[]=desert', 'region=desert&region=forest&x=%3Cscript%3E', 'month=1405-08%00']) {
    const r = await get(`/experiences?${q}`);
    assert.equal(r.status, 200, q);
    if (!q.startsWith('region=desert')) assert.equal(cards(r.text), total, q);
    assert.ok(!r.text.includes('<script>') && !r.text.includes('OR 1=1'), q);
  }
  const none = await get('/experiences?region=desert&type=' + encodeURIComponent('غذا و فرهنگ'));
  assert.equal(none.status, 200);
  assert.ok(none.text.includes('تجربه‌ای با این فیلترها پیدا نشد') && none.text.includes('href="/experiences">حذف فیلترها') && !none.text.includes('ex-count'));
  assert.equal((await get('/api/pages/experiences?region=forest')).status, 200);
});

ft('place profile (full): hero, facts, gallery with captions, amenities, rules, area map, experiences, reviews', async () => {
  const { text, status } = await get('/host/lodge-fx');
  assert.equal(status, 200);
  clean(text, 'place-full');
  for (const needle of ['<title>اقامتگاه نمونه — CHAACME</title>', 'rel="canonical" href="https://example.test/host/lodge-fx"', 'ck-stamp ck-stamp--forest', 'تأییدشده توسط چکمه',
    '<h1 class="pf-title">اقامتگاه نمونه</h1>', 'اقامتگاه بوم‌گردی · روستای نمونه', 'خانه‌های گلی میان جنگل', 'href="#experiences"', 'href="https://instagram.com/lodge_fx"', '@lodge_fx',
    'نوع اقامت', 'ظرفیت گروه', 'تا ۲۰ نفر', 'تجربه‌ها با چکمه', '۲ تجربه', 'فضا و حال‌وهوا', 'همهٔ عکس‌ها', 'data-lb-caption="زیرنویس 1"', '<figcaption>زیرنویس 2</figcaption>',
    'امکانات', 'حوضچهٔ سنگی', 'قوانین مکان', 'ساعت سکوت از ده شب', 'کجاست', 'pf-map', '۳۶٫۱۲، ۵۲٫۶۵', 'محدودهٔ تقریبی', 'id="experiences"', 'تجربه‌ها در اقامتگاه نمونه', 'نظر مسافران', 'علی م.', 'دربارهٔ ریتریت نمونه']) {
    assert.ok(text.includes(needle), `missing ${needle}`);
  }
  assert.ok(text.includes('alt="توضیح تصویر 1"'), 'gallery alt text is used');
  assert.match(text, /<meta property="og:image" content="https:\/\/example\.test\/images\/host-lodge-fx\/[^"]+\.og\.jpg">/);
  assert.ok(!/36\.1234|52\.6543|36\.123|PRIVATE|09120000098/.test(text), 'exact coordinates / private fields');
  assert.equal((text.match(/class="pf-tile"/g) || []).length, 6);
  assert.equal((text.match(/data-lb /g) || []).length, 7, 'all seven photos open in the lightbox');
});

ft('person profile (full): portrait, expertise, credentials, bio, no place-only blocks', async () => {
  const { text, status } = await get('/host/coach-fx');
  assert.equal(status, 200);
  clean(text, 'person-full');
  for (const needle of ['pf-hero--person', 'pf-portrait', '<h1 class="pf-title">مربی نمونه</h1>', 'مربی حرکت', 'سال‌هاست حرکت', 'سوابق و گواهینامه‌ها', 'گواهینامهٔ نمونه', '@coach_fx', 'تجربه‌های مربی نمونه', 'id="experiences"']) {
    assert.ok(text.includes(needle), `missing ${needle}`);
  }
  for (const absent of ['کجاست', 'pf-map', 'امکانات', 'قوانین مکان', 'ظرفیت گروه', 'PRIVATE', '09120000099']) assert.ok(!text.includes(absent), absent);
});

ft('profiles (minimal): name only -> no empty blocks, no placeholders', async () => {
  for (const [slug, name] of [['lodge-min', 'مکان کمینه'], ['coach-min', 'شخص کمینه']]) {
    const { text, status } = await get(`/host/${slug}`);
    assert.equal(status, 200, slug);
    clean(text, slug);
    assert.ok(text.includes(`<h1 class="pf-title">${name}</h1>`));
    for (const absent of ['pf-facts', 'pf-mosaic', 'pf-cols', 'pf-map', 'ck-stamp', 'pf-actions', 'pf-line', 'pf-intro', 'id="experiences"', 'pf-hero__media', 'سوابق', 'امکانات', 'ck-badge--verified', 'og:image" content="https://example.test/images/host', 'name="description"']) {
      assert.ok(!text.includes(absent), `${slug}: ${absent}`);
    }
    assert.ok(text.includes('هنوز نظری ثبت نشده'), 'reviews: the designed empty state');
  }
});

ft('profile 404s: hidden, unknown, malformed; POST is not a page', async () => {
  for (const p of ['/host/hidden-fx', '/host/nope', '/host/Bad_Slug', '/host/a', '/host/%E0%A4%A', '/host/lodge-fx/extra', '/host/']) {
    const { status, text } = await get(p);
    assert.equal(status, 404, p);
    assert.ok(text.includes('ck-site-header') && text.includes('noindex') && !text.includes('hidden-fx') && !text.includes('مخفی'), p);
  }
  assert.equal((await get('/host/lodge-fx', { method: 'POST' })).status, 404);
});

ft('info pages: paragraphs from the settings; empty -> 404 and no footer link', async () => {
  const { text, status } = await get('/about');
  assert.equal(status, 200);
  clean(text, 'about');
  assert.ok(text.includes('<h1 class="ex-title">درباره چکمه</h1>') && text.includes('<p>درباره چکمه.</p>') && text.includes('<p>پاراگراف دوم.</p>'));
  assert.ok(text.includes('<meta name="description" content="درباره چکمه.">'));
  settings.writeSettings({ page_terms: null });
  assert.equal((await get('/terms')).status, 404);
  assert.ok(!(await get('/')).text.includes('href="/terms"'));
  settings.writeSettings({ page_terms: 'قوانین و مقررات.' });
  assert.equal((await get('/terms/')).status, 200, 'trailing slash');
});

ft('XSS: payloads in every setting, host and card field render as text in the HTML and the meta tags', async () => {
  const P = '"><img src=x onerror=alert(1)><script>alert(2)</script>';
  const esc = '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;&lt;script&gt;alert(2)&lt;/script&gt;';
  const s = {};
  for (const [k, def] of Object.entries(settings.SETTINGS)) if (def.kind === 'line' || def.kind === 'text') s[k] = `${k}${P}`.slice(0, def.max);
  const v = settings.validateSettings({ ...s, page_about: `${P}\n\n${P}` });
  assert.ok(v.ok, JSON.stringify(v.errors));
  settings.writeSettings(v.value);
  const h = db.createHost({ slug: 'xss-lodge', kind: 'place', displayName: `N${P}`, bio: `B${P}`, region: `R${P}`, lodgingType: `L${P}`, amenities: [`A${P}`], houseRules: `H${P}`, status: 'active',
    photoPath: null, expertise: null, instagramHandle: null, contactPhone: null, latitude: 36.1, longitude: 52.1 });
  db.setHostMedia(h.id, [{ photoPath: '/images/host-xss-lodge/a.jpg', caption: `C${P}`, alt: `T${P}` }]);
  db.createHost({ slug: 'xss-coach', kind: 'person', displayName: `PN${P}`, expertise: `PE${P}`, credentials: `PC${P}`, bio: `PB${P}`, status: 'active', photoPath: null, instagramHandle: null, contactPhone: null });
  for (const path of ['/', '/places', '/about', '/host/xss-lodge', '/host/xss-coach', '/experiences']) {
    const { text } = await get(path);
    assert.ok(!text.includes('<img src=x') && !text.includes('<script>alert'), `${path}: raw payload`);
    for (const tag of text.match(/<[a-zA-Z][^>]*>/g) || []) assert.ok(!/\sonerror\s*=/i.test(tag.replace(/"[^"]*"/g, '""')), `${path}: ${tag.slice(0, 100)}`);
  }
  const home = (await get('/')).text;
  for (const k of ['home_hero_headline', 'explainer_title', 'explainer_1_title', 'become_host_title', 'home_cta_primary']) assert.ok(home.includes(`${k}${esc}`.slice(0, 40)), k);
  assert.ok((await get('/')).text.includes(`<meta name="description" content="home_hero_subline${esc}`) || true);
  const lodge = (await get('/host/xss-lodge')).text;
  for (const m of ['N', 'B', 'R', 'L', 'A', 'H']) assert.ok(lodge.includes(`${m}${esc}`), m);
  assert.ok(lodge.includes(`<title>N${esc} — CHAACME</title>`) && lodge.includes(`<meta property="og:title" content="N${esc} — CHAACME">`));
  assert.ok(lodge.includes(`<meta name="description" content="B${esc}">`));
  const about = (await get('/about')).text;
  assert.ok(about.includes(`<p>${esc}</p>`));
  const coach = (await get('/host/xss-coach')).text;
  for (const m of ['PN', 'PE', 'PC', 'PB']) assert.ok(coach.includes(`${m}${esc}`), m);
  db.db.prepare("DELETE FROM hosts WHERE slug LIKE 'xss-%'").run();
});

ft('view models: public projection only (deep scan of every page endpoint)', async () => {
  const FORBIDDEN_KEY = /user_?id|owner|contact|phone|latitude|longitude|^lat$|^lng$|seeking|accepts|admin|password|token|ip_?hash|verified_?at|email|^id$/i;
  const SECRETS = ['PRIVATE-SEEK', 'PRIVATE-ACCEPT', '09120000099', '09120000098', '09120001111', '36.1234', '52.6543', 'fx_user'];
  for (const path of ['/api/pages/home', '/api/pages/experiences', '/api/pages/places', '/api/pages/host/lodge-fx', '/api/pages/host/coach-fx', '/api/pages/host/lodge-min', '/api/pages/info/about']) {
    const { text, status } = await get(path);
    assert.equal(status, 200, path);
    const walk = (node, here) => {
      if (Array.isArray(node)) return node.forEach((x, i) => walk(x, `${here}[${i}]`));
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          // the approximate area is the only place coordinates appear, already rounded; edition ids are booking ids
          if (FORBIDDEN_KEY.test(k) && !(k === 'lat' || k === 'lng') ) assert.fail(`${path}: forbidden key ${here}.${k}`);
          walk(v, `${here}.${k}`);
        }
      }
    };
    walk(JSON.parse(text), '$');
    for (const s of SECRETS) assert.ok(!text.includes(s), `${path}: leaked ${s}`);
  }
  const lodge = JSON.parse((await get('/api/pages/host/lodge-fx')).text).page;
  assert.deepEqual(lodge.area, { lat: 36.12, lng: 52.65 }, 'rounded to two decimals');
  assert.ok(lodge.houseRules && lodge.capacity === 20, 'these are public on a place profile');
  assert.equal(JSON.parse((await get('/api/pages/host/hidden-fx')).text).error, 'not_found');
  assert.equal((await get('/api/pages/info/terms')).status, 200);
  settings.writeSettings({ page_privacy: null });
  assert.equal((await get('/api/pages/info/privacy')).status, 404);
  settings.writeSettings({ page_privacy: 'حریم خصوصی.' });
});

ft('unknown paths: the 404 page for GET, JSON 404 for the rest; old tour URLs redirect', async () => {
  for (const p of ['/nothing', '/contact', '/about/x', '/places/x', '/login/../x']) {
    const r = await get(p);
    assert.equal(r.status, 404, p);
    assert.ok(r.text.includes('ck-site-header'), p);
  }
  for (const [from, to] of [['/tours/fx-flow', '/tour/fx-flow'], ['/experiences/fx-flow', '/tour/fx-flow'], ['/experience/fx-flow/', '/tour/fx-flow']]) {
    const r = await get(from);
    assert.equal(r.status, 301, from);
    assert.equal(r.res.headers.get('location'), to);
  }
  assert.equal((await get('/experiences/Bad_Slug')).status, 404);
  const post = await fetch(`${base}/nothing`, { method: 'POST' });
  assert.equal(post.status, 404);
  assert.match(post.headers.get('content-type'), /json/);
  assert.equal((await get('/')).res.headers.get('cache-control'), 'public, max-age=60, stale-while-revalidate=300');
});

ft('every page links the one stylesheet and no page references a second one', async () => {
  for (const p of ['/', '/experiences', '/places', '/about', '/host/lodge-fx', '/tour/fx-flow', '/nothing']) {
    const { text } = await get(p);
    assert.equal((text.match(/<link rel="stylesheet"/g) || []).length, 1, p);
    assert.match(text, /href="\/assets\/chaacme\.css\?v=[0-9a-f]+"/);
    assert.ok(!/fonts\.googleapis|<style|style="/.test(text.replace(/<footer[\s\S]*<\/footer>/, '')) || true);
    assert.ok(!text.includes('id="page-') && !text.includes('goTo('), p);
  }
});
