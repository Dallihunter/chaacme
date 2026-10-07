// Site-wide content the admin edits («صفحهٔ اول و تنظیمات»): the home page copy and media, the
// become-host band, the footer, the Instagram handle and the four info pages.
//
//  * Keys are whitelisted below; a row for any other key is never read.
//  * Values are PLAIN TEXT. Nothing here is HTML: the templates escape everything, the info pages
//    keep paragraphs by splitting on blank lines.
//  * Empty means "not set": setting a key to '' / null deletes the row, and every block that
//    depends on a value is hidden while it is missing. Nothing is seeded.
import { db } from './db.js';
import { isPublicImagePath } from './util.js';
import { INFO_PAGES, instagramUrl, telHref, isEmail, asciiDigits } from '../deploy/assets/js/shared/site.js';

const HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;
export const VIDEO_PATH_RE = /^\/images\/site\/[A-Za-z0-9][A-Za-z0-9._-]*\.mp4$/;

/** Internal destinations a footer link may use; an external link must be https. */
export const FOOTER_PATHS = ['/', '/experiences', '/places', '/become-host', '/about', '/contact', '/terms', '/refund', '/privacy'];
const MAX_FOOTER_LINKS = 8;

// kind: line = one trimmed line; text = paragraphs; image/video = path from the upload endpoints
const field = (kind, max = 0) => ({ kind, max });
export const SETTINGS = {
  home_hero_video: field('video'),
  home_hero_poster: field('image'),
  home_hero_image: field('image'),
  home_hero_headline: field('line', 120),
  home_hero_subline: field('text', 300),
  home_cta_primary: field('line', 40),
  home_cta_secondary: field('line', 40),
  explainer_title: field('line', 100),
  explainer_text: field('text', 600),
  explainer_1_title: field('line', 40), explainer_1_text: field('line', 120), explainer_1_image: field('image'),
  explainer_2_title: field('line', 40), explainer_2_text: field('line', 120), explainer_2_image: field('image'),
  explainer_3_title: field('line', 40), explainer_3_text: field('line', 120), explainer_3_image: field('image'),
  become_host_title: field('line', 120),
  become_host_text: field('text', 400),
  become_host_cta: field('line', 40),
  instagram_handle: field('handle'),
  footer_links: field('links'),
  contact_phone: field('phone'),
  contact_email: field('email'),
  contact_address: field('text', 300),
  contact_hours: field('text', 200),
  page_about: field('text', 20000),
  page_terms: field('text', 20000),
  page_refund: field('text', 20000),
  page_privacy: field('text', 20000)
};
export const SETTING_KEYS = Object.keys(SETTINGS);

const clean = (s) => String(s).replace(/\r\n?/g, '\n');

/** Normalises one value. Returns { value } (null = delete) or { error }. */
function normalise(key, raw) {
  const def = SETTINGS[key];
  if (raw === null || raw === undefined || raw === '') return { value: null };
  if (def.kind === 'links') {
    let list = raw;
    if (typeof raw === 'string') { try { list = JSON.parse(raw); } catch { return { error: 'type' }; } }
    if (!Array.isArray(list)) return { error: 'type' };
    if (list.length > MAX_FOOTER_LINKS) return { error: 'length' };
    const out = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') return { error: 'type' };
      const label = typeof item.label === 'string' ? item.label.replace(/\s+/g, ' ').trim() : '';
      const href = typeof item.href === 'string' ? item.href.trim() : '';
      if (!label && !href) continue;
      if (!label || label.length > 30) return { error: 'label' };
      if (!FOOTER_PATHS.includes(href)) {
        let u = null;
        try { u = new URL(href); } catch { /* not absolute */ }
        if (!u || u.protocol !== 'https:' || href.length > 300 || /\s/.test(href)) return { error: 'href' };
      }
      out.push({ label, href });
    }
    return { value: out.length ? JSON.stringify(out) : null };
  }
  if (typeof raw !== 'string') return { error: 'type' };
  if (def.kind === 'image') {
    const v = raw.trim();
    return isPublicImagePath(v) ? { value: v } : { error: 'format' };
  }
  if (def.kind === 'video') {
    const v = raw.trim();
    return VIDEO_PATH_RE.test(v) ? { value: v } : { error: 'format' };
  }
  if (def.kind === 'phone') {
    // stored with ASCII digits; must make a usable tel: link
    const v = asciiDigits(raw).replace(/\s+/g, ' ').trim();
    if (!v) return { value: null };
    return v.length <= 30 && /^[0-9+\-() ]+$/.test(v) && telHref(v) ? { value: v } : { error: 'format' };
  }
  if (def.kind === 'email') {
    const v = raw.trim();
    if (!v) return { value: null };
    return isEmail(v) ? { value: v } : { error: 'format' };
  }
  if (def.kind === 'handle') {
    // accepts @name or a pasted instagram.com URL, stores the bare handle
    const v = raw.trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/\/+$/, '');
    if (!v) return { value: null };
    return HANDLE_RE.test(v) ? { value: v } : { error: 'format' };
  }
  const v = def.kind === 'line'
    ? clean(raw).replace(/\s+/g, ' ').trim()
    : clean(raw).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!v) return { value: null };
  if (v.length > def.max) return { error: 'length' };
  return { value: v };
}

/** { ok, value: { key: string|null } } for the keys present in `patch`, or { ok:false, errors }. Unknown keys are an error. */
export function validateSettings(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return { ok: false, errors: { values: 'type' } };
  // null-prototype maps: a key named __proto__ must be recorded as an error, not swallowed by the setter
  const errors = Object.create(null);
  const value = Object.create(null);
  for (const [key, raw] of Object.entries(patch)) {
    if (!Object.hasOwn(SETTINGS, key)) { errors[key] = 'unknown'; continue; }
    const r = normalise(key, raw);
    if (r.error) errors[key] = r.error; else value[key] = r.value;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

/** Every known key -> its stored string, or null. */
export function getSettings() {
  const out = Object.fromEntries(SETTING_KEYS.map((k) => [k, null]));
  for (const r of db.prepare('SELECT key, value FROM site_settings').all()) {
    if (Object.hasOwn(SETTINGS, r.key)) out[r.key] = r.value;
  }
  return out;
}

const isSiteFile = (v) => typeof v === 'string' && v.startsWith('/images/site/');

/**
 * Writes validated values in one transaction. Returns { settings, orphaned } where `orphaned` lists
 * /images/site/ files that no setting references any more; the caller deletes them (after commit).
 */
export function writeSettings(values) {
  const before = getSettings();
  const upsert = db.prepare(`INSERT INTO site_settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);
  const del = db.prepare('DELETE FROM site_settings WHERE key = ?');
  db.exec('BEGIN');
  try {
    for (const [k, v] of Object.entries(values)) { if (v === null) del.run(k); else upsert.run(k, v); }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  const after = getSettings();
  const stillUsed = new Set(Object.values(after).filter(isSiteFile));
  const orphaned = [];
  for (const k of Object.keys(values)) {
    const old = before[k];
    if (isSiteFile(old) && old !== after[k] && !stillUsed.has(old) && !orphaned.includes(old)) orphaned.push(old);
  }
  return { settings: after, orphaned };
}

// ---------------------------------------------------------------------------------------------
// What the pages read
// ---------------------------------------------------------------------------------------------

/** The body of an info page as paragraphs, or [] when it has not been written. */
export function infoParagraphs(text) {
  return String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

function parseLinks(raw) {
  if (!raw) return [];
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
}

/** The contact page's data, or null while nothing is filled in. */
export function contactDetails(settings = getSettings()) {
  const lines = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);
  const c = {
    phone: settings.contact_phone || null,
    email: settings.contact_email || null,
    address: lines(settings.contact_address),
    hours: lines(settings.contact_hours)
  };
  return c.phone || c.email || c.address.length || c.hours.length ? c : null;
}

/** Info pages that have content, as { key, path, label, paragraphs? / contact? }. */
export function publishedInfoPages(settings = getSettings()) {
  return INFO_PAGES.map((p) => (p.key === 'contact'
    ? { ...p, contact: contactDetails(settings) }
    : { ...p, paragraphs: infoParagraphs(settings[p.setting]) }))
    .filter((p) => (p.key === 'contact' ? p.contact : p.paragraphs.length));
}

/**
 * What every server-rendered page needs: the footer links (only pages that exist), the Instagram
 * handle. Order: become-host, the info pages that have content, the admin's extra links, Instagram.
 */
export function siteContext(settings = getSettings()) {
  const links = [{ label: 'همکاری با چکمه', href: '/become-host' }];
  const seen = new Set(links.map((l) => l.href));
  const add = (label, href) => { if (!seen.has(href)) { seen.add(href); links.push({ label, href }); } };
  const info = publishedInfoPages(settings);
  const infoPaths = new Set(INFO_PAGES.map((p) => p.path));
  for (const p of info) add(p.label, p.path);
  for (const l of parseLinks(settings.footer_links)) {
    if (infoPaths.has(l.href) && !info.some((p) => p.path === l.href)) continue; // a link to an empty info page
    add(l.label, l.href);
  }
  const ig = instagramUrl(settings.instagram_handle);
  if (ig) add('اینستاگرام', ig);
  return { footerLinks: links, instagramHandle: settings.instagram_handle || null };
}
