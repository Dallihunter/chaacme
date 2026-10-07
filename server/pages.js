import {
  renderTourDocument, renderHomeDocument, renderExperiencesDocument, renderPlacesDocument, renderHostDocument,
  renderInfoDocument, renderScreenDocument, renderNotFound, renderServerError, sendDocument
} from './render.js';
import { HOST_SLUG_RE } from './util.js';

// Public pages are rendered by the server as full HTML (render.js: view model ->
// shared templates), so crawlers and visitors without JavaScript get the real
// content, title and Open Graph tags. If rendering ever throws, the visitor gets the
// generic error page (never a stack trace).

export const TOUR_PATH_RE = /^\/tour\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/;

function renderOrError(req, res, build) {
  try {
    sendDocument(req, res, build());
  } catch (err) {
    console.error('[chaacme-platform] page render failed', err);
    if (res.headersSent) { res.end(); return; }
    sendDocument(req, res, renderServerError());
  }
}

const INFO_PATHS = { '/about': 'about', '/contact': 'contact', '/terms': 'terms', '/refund': 'refund', '/privacy': 'privacy' };
const SCREEN_PATHS = { '/login': 'login', '/signup': 'signup', '/account': 'account', '/become-host': 'become-host', '/booking/result': 'booking-result' };
const PARTNER_PATH_RE = /^\/partner(?:\/(?:experiences|propose)|\/profile\/[a-z0-9-]+)?$/;
const HOST_PATH_RE = /^\/host\/([^/]+)\/?$/;
// URLs the old single-page app used for an experience; they now live at /tour/<slug>.
const OLD_TOUR_RE = /^\/(?:tours|experiences|experience)\/([a-z0-9]+(?:-[a-z0-9]+)*)\/?$/;

function redirect(res, location) {
  res.writeHead(301, { location, 'cache-control': 'public, max-age=3600' });
  res.end();
}

/** Returns true when it handled the request. */
export function handlePage(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const p = url.pathname;
  const trimmed = p.length > 1 ? p.replace(/\/+$/, '') : p;

  let m;
  if (p.startsWith('/tour/')) {
    m = TOUR_PATH_RE.exec(p);
    renderOrError(req, res, () => renderTourDocument(m ? m[1] : null));
    return true;
  }
  if ((m = OLD_TOUR_RE.exec(p))) { redirect(res, `/tour/${m[1]}`); return true; }
  if (trimmed === '/') { renderOrError(req, res, () => renderHomeDocument()); return true; }
  if (trimmed === '/experiences') { renderOrError(req, res, () => renderExperiencesDocument(url.searchParams)); return true; }
  if (trimmed === '/places') { renderOrError(req, res, () => renderPlacesDocument()); return true; }
  if (Object.hasOwn(INFO_PATHS, trimmed)) { renderOrError(req, res, () => renderInfoDocument(INFO_PATHS[trimmed])); return true; }
  if (Object.hasOwn(SCREEN_PATHS, trimmed)) { renderOrError(req, res, () => renderScreenDocument(SCREEN_PATHS[trimmed])); return true; }
  if (PARTNER_PATH_RE.test(trimmed)) { renderOrError(req, res, () => renderScreenDocument('partner')); return true; }
  if (p.startsWith('/host/')) {
    m = HOST_PATH_RE.exec(p);
    let slug = null;
    try { slug = m ? decodeURIComponent(m[1]) : null; } catch { slug = null; }
    renderOrError(req, res, () => renderHostDocument(slug && HOST_SLUG_RE.test(slug) ? slug : null));
    return true;
  }
  // anything else under this service that is not an API / asset / image path is a page that does not exist
  if (!p.startsWith('/images/')) { renderOrError(req, res, () => renderNotFound({})); return true; }
  return false;
}
