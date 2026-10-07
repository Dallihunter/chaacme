// Shared setup for the browser tests: the real app on a temp database serving everything (pages, /api, /assets,
// /images), generated fixtures, one Chromium. Needs playwright (PLAYWRIGHT_CORE=<path to its index.mjs>)
// and a Chromium (CHROMIUM_PATH); ImageMagick for the fixture images. E2E_OUT_DIR keeps the screenshots.
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repo = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');

export async function boot({ name, port = 5000 + Math.floor(Math.random() * 800), env = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), `chaacme-${name}-`));
  const O = `http://127.0.0.1:${port}`;
  Object.assign(process.env, {
    CHAACME_PLATFORM_DB: join(dir, 't.db'), IP_HASH_SALT: 'x'.repeat(24), OTP_PEPPER: 'y'.repeat(24), FRONTEND_STATIC_DIR: join(dir, 'images'),
    SERVE_STATIC: '1', PORT: String(port), HOST: '127.0.0.1', FRONTEND_ORIGIN: O, SITE_ORIGIN: O, ...env
  });
  const { server } = await import(`${repo}/server/index.js`);
  const mods = {
    db: await import(`${repo}/server/db.js`), auth: await import(`${repo}/server/auth.js`), adminAuth: await import(`${repo}/server/adminAuth.js`),
    upload: await import(`${repo}/server/upload.js`), settings: await import(`${repo}/server/settings.js`),
    fx: await import(`${repo}/test/support/fixtures.mjs`)
  };
  if (!server.listening) await new Promise((r) => server.once('listening', r));
  const pw = await import(process.env.PLAYWRIGHT_CORE || 'playwright-core');
  const chromium = pw.chromium || pw.default.chromium;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] });
  const outDir = process.env.E2E_OUT_DIR || join(tmpdir(), `chaacme-${name}-screens`);
  mkdirSync(outDir, { recursive: true });
  const errors = [];
  const newCtx = async (viewport = { width: 1280, height: 900 }, { block = true } = {}) => {
    const ctx = await browser.newContext({ viewport });
    // nothing outside the app may be fetched
    if (block) await ctx.route('**/*', (r) => (new URL(r.request().url()).origin === O ? r.continue() : r.abort()));
    return ctx;
  };
  const newPage = async (ctx) => {
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`${p.url()} ${e.message}`));
    return p;
  };
  const shot = async (p, file) => { await p.waitForTimeout(500); await p.screenshot({ path: join(outDir, file), fullPage: true }); };
  const close = async () => { await browser.close(); server.close(); };
  return { O, dir, outDir, server, browser, newCtx, newPage, shot, errors, close, ...mods };
}
