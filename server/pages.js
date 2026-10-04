import { readFileSync, statSync } from 'node:fs';
import { getTourDetail } from './db.js';

// Crawlers (Instagram, Telegram, WhatsApp) don't run JS, so /tour/<slug> needs
// its title and Open Graph tags in the HTML itself. When FRONTEND_INDEX_FILE
// points at the deployed index.html, this serves that file with the per-tour
// tags filled in; the SPA then boots and renders the page exactly as before.
// Unset, the route does nothing and nginx's plain index.html fallback applies.

const INDEX_FILE = (process.env.FRONTEND_INDEX_FILE || '').trim();
const SITE_ORIGIN = (process.env.SITE_ORIGIN || 'https://chaacme.ir').trim().replace(/\/+$/, '');
const DEFAULT_IMAGE = '/images/cover-app-chaacme.png';

// Same shape the admin enforces on tour ids.
export const TOUR_PATH_RE = /^\/tour\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/;

const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// A tour's cover must be a site-relative path; anything else (another host, a
// protocol-relative //host) falls back to the default cover.
function absoluteImage(photoPath) {
  const p = typeof photoPath === 'string' && photoPath.startsWith('/') && !photoPath.startsWith('//')
    ? photoPath : DEFAULT_IMAGE;
  return SITE_ORIGIN + p;
}

function describe(tour) {
  const text = String(tour.description || tour.tags || '').replace(/\s+/g, ' ').trim();
  return text.length > 160 ? text.slice(0, 157) + '…' : text;
}

// Replace-with-function so `$&`-style sequences in tour text are never
// interpreted by String.replace.
function setContent(html, tagPattern, content) {
  return html.replace(tagPattern, (_m, open) => `${open}${escHtml(content)}">`);
}

/** Pure: returns the shell HTML with title / OG / Twitter / canonical set for one tour. */
export function injectTourMeta(html, tour, origin = SITE_ORIGIN) {
  const title = `${tour.name} — CHAACME`;
  const desc = describe(tour);
  const url = `${origin}/tour/${encodeURIComponent(tour.id)}`;
  const image = absoluteImage(tour.photoPath);

  let out = html.replace(/<title>[^<]*<\/title>/, () => `<title>${escHtml(title)}</title>`);
  out = setContent(out, /(<meta property="og:title" content=")[^"]*">/, title);
  out = setContent(out, /(<meta name="twitter:title" content=")[^"]*">/, title);
  out = setContent(out, /(<meta property="og:description" content=")[^"]*">/, desc);
  out = setContent(out, /(<meta name="twitter:description" content=")[^"]*">/, desc);
  out = setContent(out, /(<meta property="og:url" content=")[^"]*">/, url);
  out = setContent(out, /(<meta property="og:image" content=")[^"]*">/, image);
  out = setContent(out, /(<meta name="twitter:image" content=")[^"]*">/, image);
  out = out.replace(/<meta property="og:type" content="website">/, '<meta property="og:type" content="article">');
  if (!/rel="canonical"/.test(out)) {
    out = out.replace('</title>', () => `</title>\n<link rel="canonical" href="${escHtml(url)}">`);
  }
  return out;
}

let cache = { mtimeMs: 0, html: '' };
function readShell() {
  const { mtimeMs } = statSync(INDEX_FILE);
  if (mtimeMs !== cache.mtimeMs) cache = { mtimeMs, html: readFileSync(INDEX_FILE, 'utf8') };
  return cache.html;
}

/** Returns true when it handled the request. */
export function handleTourPage(req, res, url) {
  if (!INDEX_FILE || (req.method !== 'GET' && req.method !== 'HEAD')) return false;
  if (!url.pathname.startsWith('/tour/')) return false;
  const m = TOUR_PATH_RE.exec(url.pathname);

  let shell;
  try { shell = readShell(); } catch { return false; } // unreadable file: let nginx's fallback serve it

  // A malformed slug or an unknown/hidden tour still gets the plain SPA shell
  // (so the visitor sees the app's own "not available" page) but with a 404
  // status and no per-tour tags.
  const tour = m ? getTourDetail(m[1]) : null;
  const body = tour ? injectTourMeta(shell, tour) : shell;
  res.writeHead(tour ? 200 : 404, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-cache'
  });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}
