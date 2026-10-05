import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'chaacme-'));
const PORT = 3400 + Math.floor(Math.random() * 400);
Object.assign(process.env, {
  CHAACME_PLATFORM_DB: join(dir, 't.db'), IP_HASH_SALT: 'x'.repeat(24), OTP_PEPPER: 'y'.repeat(24),
  FRONTEND_INDEX_FILE: fileURLToPath(new URL('../deploy/index.html', import.meta.url)),
  SITE_ORIGIN: 'https://example.test/', PORT: String(PORT), HOST: '127.0.0.1'
});

const { injectTourMeta, TOUR_PATH_RE } = await import('../server/pages.js');
const { server } = await import('../server/index.js');
const { readFileSync } = await import('node:fs');
const shell = readFileSync(process.env.FRONTEND_INDEX_FILE, 'utf8');
const base = `http://127.0.0.1:${PORT}`;

before(async () => { if (!server.listening) await new Promise((r) => server.once('listening', r)); });
after(() => server.close());

test('slug regex accepts tour ids and rejects junk', () => {
  for (const ok of ['/tour/desert-parthian', '/tour/a1/', '/tour/x']) assert.ok(TOUR_PATH_RE.test(ok), ok);
  for (const bad of ['/tour/', '/tour/Bad', '/tour/a--b', '/tour/-a', '/tour/a/b', '/tour/a_b', '/tours/a']) {
    assert.equal(TOUR_PATH_RE.test(bad), false, bad);
  }
});

test('injectTourMeta escapes tour text and never interprets $ patterns', () => {
  const html = injectTourMeta(shell, {
    id: 'evil', name: 'A"><script>alert(1)</script> $& $1', description: '"><img src=x onerror=1>',
    photoPath: '//evil.example/x.png'
  }, 'https://example.test');
  assert.ok(!html.includes('<script>alert(1)'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('$&amp; $1'));
  assert.ok(html.includes('og:image" content="https://example.test/images/cover-app-chaacme.png"'));
  assert.ok(html.includes('<link rel="canonical" href="https://example.test/tour/evil">'));
});

test('serves the server-rendered page for a real tour, the new 404 page for unknown or malformed slugs', async () => {
  const db = await import('../server/db.js');
  db.seed();
  const t = db.listTours().find((x) => !x.comingSoon);

  const ok = await fetch(`${base}/tour/${t.id}`);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /text\/html/);
  assert.equal(ok.headers.get('cache-control'), 'public, max-age=60, stale-while-revalidate=300');
  const body = await ok.text();
  assert.ok(body.includes(`<link rel="canonical" href="https://example.test/tour/${t.id}">`));
  assert.ok(body.includes('<title>' + t.name));
  assert.ok(body.includes('class="tp-title"')); // the real content is in the HTML, not injected by a script
  assert.ok(!body.includes('id="page-tour"')); // no longer the SPA shell

  const head = await fetch(`${base}/tour/${t.id}`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal((await head.text()), '');

  for (const slug of ['no-such-tour', 'Bad_Slug']) {
    const res = await fetch(`${base}/tour/${slug}`);
    assert.equal(res.status, 404);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const text = await res.text();
    assert.ok(text.includes('این تجربه پیدا نشد'));
    assert.ok(!text.includes('rel="canonical"'));
  }

  const post = await fetch(`${base}/tour/${t.id}`, { method: 'POST' });
  assert.equal(post.status, 404);
});
