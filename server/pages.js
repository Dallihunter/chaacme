import { renderTourDocument, renderServerError, sendDocument } from './render.js';

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

/** Returns true when it handled the request. */
export function handlePage(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const p = url.pathname;
  if (p.startsWith('/tour/')) {
    const m = TOUR_PATH_RE.exec(p);
    renderOrError(req, res, () => renderTourDocument(m ? m[1] : null));
    return true;
  }
  return false;
}
