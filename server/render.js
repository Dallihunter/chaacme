// Server-side rendering of the public pages.
//
//   view model (pagemodels.js)  ->  shared template (deploy/assets/js/shared/pages/)  ->  full HTML document
//
// Caching: the HTML is public and identical for every visitor (who is signed in is only known to
// shell.js in the browser), so it carries
//   Cache-Control: public, max-age=60, stale-while-revalidate=300
// An admin edit therefore shows within about a minute even behind a CDN.
// Versioned assets and image variants are immutable (see static.js).
import { createHash } from 'node:crypto';
import { buildTourPage, buildHomePage, buildExperiencesPage, buildPlacesPage, buildHostPage, buildInfoPage } from './pagemodels.js';
import { assetVersion, importMapFor, versioned } from './static.js';
import { siteContext } from './settings.js';
import { renderTourPage, ogImageUrl, metaDescription } from '../deploy/assets/js/shared/pages/tour.js';
import { renderNotFoundPage, renderErrorPage } from '../deploy/assets/js/shared/pages/errors.js';
import { renderScreenShell } from '../deploy/assets/js/shared/pages/screen.js';
import { renderHomePage } from '../deploy/assets/js/shared/pages/home.js';
import { renderExperiencesPage } from '../deploy/assets/js/shared/pages/experiences.js';
import { renderPlacesPage } from '../deploy/assets/js/shared/pages/places.js';
import { renderInfoPage, infoDescription } from '../deploy/assets/js/shared/pages/info.js';
import { renderHostPage, ogImageUrl as hostOgImage, metaDescription as hostDescription } from '../deploy/assets/js/shared/pages/host.js';

export const PAGE_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300';
const DEFAULT_OG_IMAGE = '/images/cover-app-chaacme.png';

export const siteOrigin = () => (process.env.SITE_ORIGIN || 'https://chaacme.ir').trim().replace(/\/+$/, '');
export const absolute = (path) => `${siteOrigin()}${path}`;

/** Asset URLs for a page. `scripts` are '/assets/js/…' entry modules (shell.js is always first). */
export function pageAssets(scripts = []) {
  const entries = ['/assets/js/shell.js', ...scripts];
  return {
    css: `/assets/chaacme.css?v=${assetVersion()}`,
    font: '/assets/fonts/vazirmatn-5.3.0-arabic.woff2',
    scripts: entries.map(versioned),
    imports: importMapFor(entries)
  };
}

export function renderNotFound(opts = {}, scripts = []) {
  return { status: 404, body: renderNotFoundPage({ assets: pageAssets(scripts), site: siteContext(), ...opts }) };
}

export function renderServerError() {
  return { status: 500, cache: 'no-store', body: renderErrorPage({ assets: pageAssets(), site: siteContext() }) };
}

/** { status, body } for /tour/<slug>; slug is null when the URL was malformed. */
export function renderTourDocument(slug) {
  const page = slug ? buildTourPage(slug) : null;
  if (!page) return renderNotFound({ what: 'این تجربه', linkLabel: 'دیدن همهٔ تجربه‌ها', href: '/experiences' });
  const body = renderTourPage(page, {
    assets: pageAssets(['/assets/js/tour-island.js']),
    site: siteContext(),
    canonical: absolute(`/tour/${encodeURIComponent(page.slug)}`),
    ogImage: absolute(ogImageUrl(page) || DEFAULT_OG_IMAGE),
    description: metaDescription(page)
  });
  return { status: 200, body };
}

/** { status, body } for / */
export function renderHomeDocument() {
  const page = buildHomePage();
  const hero = page.hero;
  const text = hero && hero.subline ? hero.subline.replace(/\s+/g, ' ').trim() : '';
  const img = hero && (hero.poster || hero.image);
  const body = renderHomePage(page, {
    assets: pageAssets(['/assets/js/home-island.js']), site: siteContext(), canonical: absolute('/'),
    ogImage: absolute(img ? (img.og ? img.og.url : (img.variants[img.variants.length - 1] || {}).url || img.path) : DEFAULT_OG_IMAGE),
    description: text.length > 160 ? `${text.slice(0, 157)}…` : text
  });
  return { status: 200, body };
}

/** { status, body } for /experiences?… */
export function renderExperiencesDocument(params) {
  const page = buildExperiencesPage(params);
  return { status: 200, body: renderExperiencesPage(page, { assets: pageAssets(['/assets/js/experiences-island.js']), site: siteContext(), canonical: absolute('/experiences') }) };
}

export function renderPlacesDocument() {
  return { status: 200, body: renderPlacesPage(buildPlacesPage(), { assets: pageAssets(), site: siteContext(), canonical: absolute('/places') }) };
}

/** { status, body } for /host/<slug>; slug null when malformed. */
export function renderHostDocument(slug) {
  const page = slug ? buildHostPage(slug) : null;
  if (!page) return renderNotFound({ what: 'این پروفایل', linkLabel: 'دیدن مکان‌ها', href: '/places' });
  const img = hostOgImage(page);
  return {
    status: 200,
    body: renderHostPage(page, {
      assets: pageAssets(['/assets/js/profile-island.js']), site: siteContext(),
      canonical: absolute(`/host/${encodeURIComponent(page.slug)}`),
      ogImage: absolute(img || DEFAULT_OG_IMAGE), description: hostDescription(page)
    })
  };
}

/** { status, body } for /about /terms /refund /privacy: 404 while the body is empty. */
export function renderInfoDocument(key) {
  const page = buildInfoPage(key);
  if (!page) return renderNotFound({});
  return { status: 200, body: renderInfoPage(page, { assets: pageAssets(), site: siteContext(), canonical: absolute(page.path) }) };
}

/** The shell of a client-rendered screen; `script` is its entry module. Never cached: it sits in front of private data. */
export function renderScreenDocument(name) {
  return { status: 200, cache: 'no-cache', body: renderScreenShell(name, { assets: pageAssets([`/assets/js/screens/${name}.js`]), site: siteContext() }) };
}

/** Writes the response for a rendered document (HEAD-aware, with a weak ETag so revalidation is cheap). */
export function sendDocument(req, res, { status, body, cache = PAGE_CACHE_CONTROL }) {
  const etag = `W/"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': cache, etag };
  if (status === 200 && req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  res.writeHead(status, headers);
  return res.end(req.method === 'HEAD' ? undefined : body);
}
