// Server-side rendering of the public pages (currently: the experience page).
//
//   GET /tour/<slug>  ->  full HTML built from the view model (pagemodels.js)
//                         by the shared templates (deploy/assets/js/shared/pages/)
//
// Caching: the HTML is public and identical for every visitor, so it carries
//   Cache-Control: public, max-age=60, stale-while-revalidate=300
// An admin edit therefore shows within about a minute even behind a CDN.
// Versioned assets and image variants are immutable (see static.js).
import { createHash } from 'node:crypto';
import { buildTourPage } from './pagemodels.js';
import { assetVersion, sharedModuleUrls } from './static.js';
import { renderTourPage, renderNotFoundPage, ogImageUrl, metaDescription } from '../deploy/assets/js/shared/pages/tour.js';

export const PAGE_CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=300';
// Shared modules tour-island.js imports; only these go in the page's import map.
const ISLAND_MODULES = ['/assets/js/shared/format.js'];
const DEFAULT_OG_IMAGE = '/images/cover-app-chaacme.png';

const siteOrigin = () => (process.env.SITE_ORIGIN || 'https://chaacme.ir').trim().replace(/\/+$/, '');

function assets() {
  const v = assetVersion();
  return {
    css: `/assets/chaacme.css?v=${v}`,
    font: '/assets/fonts/vazirmatn-5.3.0-arabic.woff2',
    script: `/assets/js/tour-island.js?v=${v}`,
    imports: Object.fromEntries(Object.entries(sharedModuleUrls()).filter(([url]) => ISLAND_MODULES.includes(url)))
  };
}

const absolute = (path) => `${siteOrigin()}${path}`;

/** { status, body } for /tour/<slug>; slug is null when the URL was malformed. */
export function renderTourDocument(slug) {
  const page = slug ? buildTourPage(slug) : null;
  if (!page) return { status: 404, body: renderNotFoundPage({ assets: assets() }) };
  const body = renderTourPage(page, {
    assets: assets(),
    canonical: absolute(`/tour/${encodeURIComponent(page.slug)}`),
    ogImage: absolute(ogImageUrl(page) || DEFAULT_OG_IMAGE),
    description: metaDescription(page)
  });
  return { status: 200, body };
}

/** Writes the response for a rendered document (HEAD-aware, with a weak ETag so revalidation is cheap). */
export function sendDocument(req, res, { status, body }) {
  const etag = `W/"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': PAGE_CACHE_CONTROL, etag };
  if (status === 200 && req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  res.writeHead(status, headers);
  return res.end(req.method === 'HEAD' ? undefined : body);
}
