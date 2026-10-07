// Generated fixtures for the page tests and the screenshot runs: gradient images made with
// ImageMagick (no photos of anyone), people and places with invented names.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';

export const hasMagick = (() => { try { execFileSync('convert', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } })();

const PALETTE = ['#a84b24', '#2f5d46', '#1f6b78', '#d9a23a', '#7d5a8a', '#5f554a', '#c46a3d', '#3f7f8c'];

/**
 * Makes a gradient image and stores it through the real upload code (so variants and EXIF handling run).
 * fields: multipart text fields (tourId / hostSlug / site). Returns the public path, or null without ImageMagick.
 */
export function imageMaker(upload, workDir) {
  let n = 0;
  mkdirSync(workDir, { recursive: true });
  return async function makeImage(fields = {}, w = 2400, h = 1600) {
    if (!hasMagick) return null;
    n += 1;
    const f = join(workDir, `fx-${n}.jpg`);
    const a = PALETTE[n % PALETTE.length]; const b = PALETTE[(n + 3) % PALETTE.length];
    execFileSync('convert', ['-size', `${w}x${h}`, `gradient:${a}-${b}`, `jpeg:${f}`]);
    const bd = '----fx' + n;
    const text = Object.entries(fields).map(([k, v]) => `--${bd}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('');
    const body = Buffer.concat([Buffer.from(`${text}--${bd}\r\nContent-Disposition: form-data; name="file"; filename="x.jpg"\r\n\r\n`), readFileSync(f), Buffer.from(`\r\n--${bd}--\r\n`)]);
    const req = Readable.from([body]); req.headers = { 'content-type': `multipart/form-data; boundary=${bd}` };
    const r = await upload.handleUpload(req);
    if (r.status !== 201) throw new Error(`fixture upload failed: ${r.error}`);
    return r.path;
  };
}

export const future = (db, days) => db.todayIso(new Date(Date.now() + days * 864e5));

/** A file that passes the mp4 magic-byte check (it will not play; the page shows the poster). */
export function fakeMp4(dir, name = 'hero.mp4') {
  mkdirSync(dir, { recursive: true });
  const f = join(dir, name);
  writeFileSync(f, Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypisom'), Buffer.alloc(8), Buffer.alloc(256)]));
  return f;
}

/**
 * The "full" site: every setting, a place and a person with everything filled, tours across regions and
 * months, reviews, and the four info pages. All names are invented.
 */
export async function seedFullSite({ db, upload, settings, makeImage, videoPath = null }) {
  const img = (f, w, h) => makeImage(f, w, h);
  const userId = Number(db.db.prepare("INSERT OR IGNORE INTO users (phone, first_name, last_name, username) VALUES ('09120001111','سارا','تست','fx_user')").run().lastInsertRowid)
    || db.db.prepare("SELECT id FROM users WHERE username='fx_user'").get().id;

  const H = (v) => db.createHost({ photoPath: null, bio: null, expertise: null, instagramHandle: null, contactPhone: null, ...v });
  const place = H({
    slug: 'lodge-fx', kind: 'place', displayName: 'اقامتگاه نمونه', status: 'active', photoPath: await img({ hostSlug: 'lodge-fx' }, 1800, 1200),
    bio: 'خانه‌های گلی میان جنگل، با سکوی چوبی و حیاط بزرگ؛ جایی برای آرام شدن.', region: 'روستای نمونه، شهرستان نمونه', lodgingType: 'اقامتگاه بوم‌گردی',
    amenities: ['سکوی تمرین سرپوشیده', 'حوضچهٔ سنگی', 'اتاق با شومینه', 'غذای محلی', 'چمن برای دورهمی'], latitude: 36.123456, longitude: 52.654321,
    instagramHandle: 'lodge_fx', contactPhone: '09120000098', userId, capacityGuests: 20, houseRules: 'ساعت سکوت از ده شب.\nحیوان خانگی با هماهنگی.',
    acceptsExperienceTypes: ['PRIVATE-ACCEPT'], regionKey: 'forest', verified: true
  });
  const gal = [];
  for (let i = 0; i < 7; i++) gal.push({ photoPath: await img({ hostSlug: 'lodge-fx' }, i % 2 ? 1200 : 1800, 1200), caption: i < 5 ? `زیرنویس ${'۱۲۳۴۵۶۷'[i]}` : null, alt: `توضیح تصویر ${'۱۲۳۴۵۶۷'[i]}` });
  db.setHostMedia(place.id, gal);

  const person = H({
    slug: 'coach-fx', kind: 'person', displayName: 'مربی نمونه', status: 'active', photoPath: await img({ hostSlug: 'coach-fx' }, 900, 900),
    bio: 'سال‌هاست حرکت و طبیعت را کنار هم تمرین می‌کنم.', expertise: 'مربی حرکت', credentials: 'گواهینامهٔ نمونه از مرکز نمونه', instagramHandle: 'coach_fx',
    contactPhone: '09120000099', userId, seekingPlaceTypes: ['PRIVATE-SEEK'], verified: true, credentialsPublic: true
  });
  // credentials the owner never agreed to publish (the default): must never reach a page
  H({ slug: 'coach-private', kind: 'person', displayName: 'مربی خصوصی', status: 'active', expertise: 'مربی', credentials: 'TEAM-ONLY-CREDENTIALS' });
  H({ slug: 'lodge-min', kind: 'place', displayName: 'مکان کمینه', status: 'active' });
  H({ slug: 'coach-min', kind: 'person', displayName: 'شخص کمینه', status: 'active' });
  H({ slug: 'hidden-fx', kind: 'place', displayName: 'مخفی', status: 'hidden' });

  const tour = async (id, over, days, cap = 14) => {
    const g = [await img({ tourId: id }), await img({ tourId: id })];
    db.createTour({ id, status: 'published', name: over.name, duration: '۳ روز و ۲ شب', price: over.price, region: over.region, experienceType: over.type, galleryImages: ['الف', 'ب'], galleryPhotos: g, story: 'داستان این تجربه.', ...over.extra });
    for (const d of days) db.addTourDate(id, { label: `اجرا ${d}`, capacity: cap, startsOn: future(db, d), endsOn: future(db, d + 2) });
  };
  await tour('fx-flow', { name: 'ریتریت نمونه', price: 23000000, region: 'forest', type: 'ریتریت حرکتی' }, [25, 55]);
  await tour('fx-tea', { name: 'چای از باغ تا فنجان', price: 18500000, region: 'forest', type: 'غذا و فرهنگ' }, [40]);
  await tour('fx-desert', { name: 'کویر نمونه', price: 31000000, region: 'desert', type: 'ریتریت حرکتی' }, [70]);
  db.createTour({ id: 'fx-soon', status: 'coming_soon', name: 'جزیرهٔ نمونه', region: 'sea' });
  db.createTour({ id: 'fx-full', status: 'published', name: 'تجربهٔ پر', price: 9000000, region: 'desert', experienceType: 'موسیقی' });
  const closed = db.addTourDate('fx-full', { label: 'پر', capacity: 3, startsOn: future(db, 20) });
  db.updateTourDate(closed.id, { closed: true });
  db.setTourHosts('fx-flow', [{ hostId: person.id, role: 'lead' }, { hostId: place.id, role: 'venue' }]);
  db.setTourHosts('fx-tea', [{ hostId: place.id, role: 'venue' }]);
  for (const [name, rating, body] of [['علی م.', 5, 'عالی بود'], ['مریم ک.', 4, 'خیلی خوب']]) {
    const rv = db.createReview({ tourId: 'fx-flow', userId, displayName: name, rating, body });
    db.setReviewStatus(rv.id, 'published');
  }

  const set = {
    home_hero_poster: await img({ site: '1' }, 2000, 1100), home_hero_image: await img({ site: '1' }, 2000, 1100),
    home_hero_headline: 'سفرهایی که از آدم‌ها و مکان‌ها ساخته می‌شوند', home_hero_subline: 'برگزارکننده‌ها و مکان‌های خاص را کنار هم می‌گذاریم و تجربه‌هایی محدود طراحی می‌کنیم.',
    home_cta_primary: 'تجربه‌های پیش‌رو', home_cta_secondary: 'چکمه چطور کار می‌کند',
    explainer_title: 'هر تجربه سه تکه دارد', explainer_text: 'یک برگزارکننده، یک مکان و یک تاریخ؛ چکمه این سه را کنار هم می‌گذارد.',
    explainer_1_title: 'برگزارکننده', explainer_1_text: 'مربی، راهنما، هنرمند', explainer_1_image: await img({ site: '1' }, 1200, 800),
    explainer_2_title: 'مکان', explainer_2_text: 'اقامتگاه، باغ، فضای برگزاری', explainer_2_image: await img({ site: '1' }, 1200, 800),
    explainer_3_title: 'مسافران', explainer_3_text: 'گروه کوچک، یک تاریخ مشخص', explainer_3_image: await img({ site: '1' }, 1200, 800),
    become_host_title: 'مربی هستی یا مکانی برای میزبانی داری؟', become_host_text: 'پروفایلت را بساز؛ چکمه تو را با نیمهٔ دیگر تجربه کنار هم می‌گذارد.', become_host_cta: 'همکاری با چکمه',
    instagram_handle: 'chaacme_fx', footer_links: [{ label: 'تجربه‌ها', href: '/experiences' }],
    contact_phone: '۰۲۱-۱۲۳۴۵۶۷۸', contact_email: 'team@chaacme.test', contact_address: 'تهران، خیابان نمونه، پلاک ۱', contact_hours: 'شنبه تا چهارشنبه، ۹ تا ۱۷',
    page_about: 'درباره چکمه.\n\nپاراگراف دوم.', page_terms: 'قوانین و مقررات.', page_refund: 'شرایط استرداد.', page_privacy: 'حریم خصوصی.'
  };
  if (videoPath) set.home_hero_video = videoPath;
  const check = settings.validateSettings(set);
  if (!check.ok) throw new Error(`fixture settings invalid: ${JSON.stringify(check.errors)}`);
  settings.writeSettings(check.value);
  return { place, person, userId };
}
