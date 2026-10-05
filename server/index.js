import { createServer } from 'node:http';
import { seed } from './db.js';
import { handleApi } from './api.js';
import { handlePage } from './pages.js';
import { handleStatic } from './static.js';
import { assertRuntimeConfig, describeRuntimeConfig, json, guardStateChange } from './util.js';

const PORT = Number(process.env.PORT) || 3100;
const HOST = process.env.HOST || '127.0.0.1';

// Mostly a JSON API. It also renders the public experience page (/tour/<slug>,
// see render.js) and serves the release's own /assets/. The rest of the site is
// still the static SPA served by nginx, which calls this API same-origin or
// cross-origin via FRONTEND_ORIGIN below.
const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || '').trim();

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin'
};

function applyCors(req, res) {
  if (!FRONTEND_ORIGIN) return;
  const origin = req.headers.origin;
  if (origin !== FRONTEND_ORIGIN) return;
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-credentials', 'true');
  res.setHeader('vary', 'Origin');
}

const server = createServer(async (req, res) => {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
  applyCors(req, res);

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (req.method === 'OPTIONS') {
      res.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
      res.setHeader('access-control-allow-headers', 'content-type, authorization');
      res.writeHead(204);
      return res.end();
    }
    if (url.pathname.startsWith('/api/')) {
      // Cross-site request forgery guard: every POST/PUT/PATCH/DELETE must come
      // from our own frontend (Origin/Referer allowlist) and carry the right
      // Content-Type. Runs before any handler, so no route can forget it.
      const gate = guardStateChange(req, url.pathname);
      if (!gate.ok) {
        // The body was not read; close the connection rather than leave it half-consumed.
        res.setHeader('connection', 'close');
        return json(res, gate.status, { error: gate.error });
      }
      return await handleApi(req, res, url);
    }
    if (handleStatic(req, res, url)) return;
    if (handlePage(req, res, url)) return;
    return json(res, 404, { error: 'not_found', message: 'Not found.' });
  } catch (err) {
    console.error('[chaacme-platform]', err);
    if (!res.headersSent) json(res, 500, { error: 'internal_error' });
    else res.end();
  }
});

for (const line of describeRuntimeConfig()) console.log(`[chaacme-platform] config: ${line}`);

const cfg = assertRuntimeConfig();
for (const w of cfg.warnings) console.warn(`[chaacme-platform] warning: ${w}`);
if (cfg.problems.length) {
  for (const p of cfg.problems) console.error(`[chaacme-platform] config error: ${p}`);
  process.exit(1);
}

const result = seed();
if (result.seeded) console.log(`[chaacme-platform] seeded ${result.tours} tours`);

server.listen(PORT, HOST, () => {
  console.log(`[chaacme-platform] listening on http://${HOST}:${PORT}`);
});

export { server };
