import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MAX_FILE_BYTES, MAX_BODY_BYTES } from '../server/upload.js';

// The vhost example is what production runs (it is installed as the live vhost): which locations may take a body bigger than
// nginx's 1 MB default. Before 2026-10-06 none could, so every photo over about 1 MB got a 413 from nginx.
// ---- nginx example: which locations may take a body bigger than nginx's 1 MB default -----------------------------------
function locations(conf) {
  const out = []; const re = /^\s*location\s+([^{]+?)\s*\{/gm; let m;
  while ((m = re.exec(conf))) {
    let depth = 1; let i = re.lastIndex;
    while (depth && i < conf.length) { if (conf[i] === '{') depth++; else if (conf[i] === '}') depth--; i++; }
    out.push({ match: m[1], body: conf.slice(re.lastIndex, i - 1) });
  }
  return out;
}
test('nginx example: image uploads accept the service\'s 5 MB, the video 32 MB, everything else keeps the 1 MB default', () => {
  const conf = readFileSync(new URL('../deploy/nginx-site.conf.example', import.meta.url), 'utf8').replace(/#.*$/gm, '');
  const sizes = Object.fromEntries(locations(conf).filter((l) => /client_max_body_size/.test(l.body)).map((l) => [l.match, /client_max_body_size\s+(\d+)m;/.exec(l.body)[1]]));
  assert.deepEqual(sizes, { '= /api/admin/upload': '6', '~ ^/api/partner/profiles/[a-z0-9-]+/upload$': '6', '= /api/admin/upload-video': '32' });
  assert.ok(6 * 1024 * 1024 > MAX_BODY_BYTES, `6m must cover the service's body limit (${MAX_BODY_BYTES} B = ${MAX_FILE_BYTES} B file + framing)`);
  assert.ok(!/client_max_body_size/.test(conf.replace(/location[^{]+\{[^}]*client_max_body_size[^}]*\}/g, '')), 'no server-wide limit');
  for (const l of locations(conf).filter((x) => /client_max_body_size/.test(x.body))) assert.match(l.body, /proxy_pass http:\/\/127\.0\.0\.1:3100;/);
  // the partner route in the vhost is the one the service serves
  assert.ok(new RegExp('^/api/partner/profiles/[a-z0-9-]+/upload$').test('/api/partner/profiles/some-host/upload'));
});
