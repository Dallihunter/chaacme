// Serves the release's own static files under /assets/ (CSS, fonts, shared and
// client JS) so the public pages work without any web-server configuration
// beyond proxying /assets/ here. In production nginx may serve the same files
// itself; the cache headers below are what it should send as well.
//
// With SERVE_STATIC=1 it also serves /images/ from FRONTEND_STATIC_DIR. That is
// for local development and the test suites only: in production nginx serves
// the images tree straight off disk.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { ASSETS_DIR, FRONTEND_STATIC_DIR } from './paths.js';

const TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
};
const ASSET_EXT = new Set(['.css', '.js', '.woff2']);
const IMAGE_EXT = new Set(['.jpg', '.png', '.webp']);

export const CACHE_IMMUTABLE = 'public, max-age=31536000, immutable';
export const CACHE_REVALIDATE = 'public, max-age=300';

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out.sort();
}

let versionMemo = null;

/** Content hash of everything under deploy/assets/ (except fonts, whose filenames carry their version). Computed once. */
export function assetVersion() {
  if (versionMemo) return versionMemo;
  const h = createHash('sha1');
  for (const f of walk(ASSETS_DIR)) {
    if (f.includes(`${sep}fonts${sep}`)) continue;
    h.update(f.slice(ASSETS_DIR.length)).update(readFileSync(f));
  }
  versionMemo = h.digest('hex').slice(0, 10);
  return versionMemo;
}

const toUrl = (f) => `/assets${f.slice(ASSETS_DIR.length).split(sep).join('/')}`;
let moduleMemo = null;

/** Every browser ES module under /assets/js, mapped to its versioned URL (so it can be cached forever). */
export function moduleUrls() {
  if (moduleMemo) return moduleMemo;
  const v = assetVersion();
  const base = join(ASSETS_DIR, 'js');
  moduleMemo = Object.fromEntries(walk(base).filter((f) => f.endsWith('.js')).map((f) => [toUrl(f), `${toUrl(f)}?v=${v}`]));
  return moduleMemo;
}

const IMPORT_RE = /(?:from|import)\s*['"](\/assets\/js\/[^'"?]+\.js)['"]/g;

/**
 * The import map a page needs: the entry scripts' static imports, transitively, each mapped to
 * its versioned URL. Entries are '/assets/js/…' paths without a version.
 */
export function importMapFor(entries) {
  const urls = moduleUrls();
  const seen = new Set();
  const visit = (url) => {
    if (seen.has(url) || !urls[url]) return;
    seen.add(url);
    let src = '';
    try { src = readFileSync(join(ASSETS_DIR, url.slice('/assets/'.length)), 'utf8'); } catch { return; }
    for (const m of src.matchAll(IMPORT_RE)) visit(m[1]);
  };
  entries.forEach(visit);
  return Object.fromEntries([...seen].sort().map((u) => [u, urls[u]]));
}

/** '/assets/js/shell.js' -> '/assets/js/shell.js?v=<hash>' */
export const versioned = (url) => `${url}?v=${assetVersion()}`;

function send(req, res, file, cache) {
  let body;
  try { body = readFileSync(file); } catch { return false; }
  const etag = `W/"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
  const headers = { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': cache, etag };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); res.end(); return true; }
  res.writeHead(200, { ...headers, 'content-length': body.length });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}

function within(root, rel) {
  const base = resolve(root);
  const file = resolve(base, rel);
  return file.startsWith(base + sep) ? file : null;
}

/** Returns true when it handled the request. */
export function handleStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  const p = url.pathname;
  let root; let allowed; let rel;
  if (p.startsWith('/assets/')) { root = ASSETS_DIR; allowed = ASSET_EXT; rel = p.slice('/assets/'.length); }
  else if (p.startsWith('/images/') && process.env.SERVE_STATIC === '1') { root = FRONTEND_STATIC_DIR; allowed = IMAGE_EXT; rel = p.slice('/images/'.length); }
  else return false;

  let decoded;
  try { decoded = decodeURIComponent(rel); } catch { decoded = ''; }
  const file = decoded && !decoded.includes('\0') && allowed.has(extname(decoded)) ? within(root, decoded) : null;
  const versioned = url.searchParams.has('v') || p.startsWith('/assets/fonts/') || p.startsWith('/images/');
  if (file && send(req, res, file, versioned ? CACHE_IMMUTABLE : CACHE_REVALIDATE)) return true;
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end('not found');
  return true;
}
