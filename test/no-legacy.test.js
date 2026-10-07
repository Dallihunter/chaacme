import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'chaacme-legacy-'));
const PORT = 5700 + Math.floor(Math.random() * 300);
Object.assign(process.env, {
  CHAACME_PLATFORM_DB: join(dir, 't.db'), IP_HASH_SALT: 'x'.repeat(24), OTP_PEPPER: 'y'.repeat(24), FRONTEND_STATIC_DIR: join(dir, 'images'),
  SITE_ORIGIN: 'https://example.test', PORT: String(PORT), HOST: '127.0.0.1'
});
const { server } = await import('../server/index.js');
const db = await import('../server/db.js');
const base = `http://127.0.0.1:${PORT}`;
before(async () => { if (!server.listening) await new Promise((r) => server.once('listening', r)); db.seed(); });
after(() => server.close());

// Markers of the pre-redesign single-page app and its stylesheet.
const LEGACY = [
  /fonts\.googleapis|fonts\.gstatic/, /family=Inter/, /--ink-soft|--ink-faint|--line-soft|--frame\b/, /class="page( active)?"/, /id="page-(home|tour|login|account|booking|host|partner|become-host|not-found|experiences)"/,
  /\bgoTo\(/, /\bfunction openTour\b/, /\bclass="site-nav"|\bclass="btn-fa/, /renderTourDetail/, /HARD_NEXT_RE/
];

test('no served page carries the old stylesheet or the old SPA (server-rendered pages, screen shells, 404, static files)', async () => {
  const paths = ['/', '/experiences', '/places', '/about', '/tour/desert-parthian', '/host/none', '/login', '/signup', '/account', '/become-host', '/booking/result', '/partner', '/partner/propose', '/nope', '/contact'];
  for (const p of paths) {
    const text = await (await fetch(base + p)).text();
    for (const re of LEGACY) assert.ok(!re.test(text), `${p} matches ${re}`);
    if (!text.includes('<html')) continue;
    assert.equal((text.match(/<link rel="stylesheet"/g) || []).length, 1, `${p}: exactly one stylesheet`);
    assert.ok(text.includes('/assets/chaacme.css?v='), p);
    assert.ok(!/<style/.test(text), `${p}: no inline stylesheet`);
  }
  for (const f of ['deploy/index.html', 'deploy/admin-index.html']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    for (const re of LEGACY) assert.ok(!re.test(src), `${f} matches ${re}`);
  }
  const admin = readFileSync(new URL('../deploy/admin-index.html', import.meta.url), 'utf8');
  assert.ok(admin.includes('/assets/chaacme.css') && !/<style/.test(admin), 'the admin uses the one stylesheet');
});

test('the repository ships exactly one stylesheet', () => {
  const walk = (d) => readdirSync(d).flatMap((n) => (n === 'node_modules' || n === '.git' || n === '.claude' || n === 'Chaacme design system refinement' ? [] : statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
  const css = walk(fileURLToPath(new URL('..', import.meta.url))).filter((f) => f.endsWith('.css'));
  assert.deepEqual(css.map((f) => f.replace(/^.*\/chaacme\//, '')), ['deploy/assets/chaacme.css'].map((f) => css.find((c) => c.endsWith(f)).replace(/^.*\/chaacme\//, '')));
  assert.equal(css.length, 1);
  assert.ok(existsSync(css[0]));
});

test('old SPA tour URLs redirect and the old nav targets are real pages or gone', async () => {
  const r = await fetch(`${base}/tours/desert-parthian`, { redirect: 'manual' });
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), '/tour/desert-parthian');
  const header = await (await fetch(base + '/')).text();
  for (const href of ['/experiences', '/places', '/become-host']) assert.ok(header.includes(`href="${href}"`), href);
  assert.equal((await fetch(`${base}/contact`)).status, 404, 'the old contact page had a placeholder e-mail; it is gone');
});
