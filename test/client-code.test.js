import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../deploy/assets/js/', import.meta.url));
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const files = walk(ROOT).filter((f) => f.endsWith('.js'));

test('browser code never turns data into markup except through mount() (no innerHTML and friends)', () => {
  const banned = /\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(|createContextualFragment|srcdoc/;
  for (const f of files) {
    const src = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!banned.test(src), `${f} uses a markup-injection API`);
  }
});

test('browser code talks only to this site (relative /api and /assets URLs)', () => {
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const abs = (src.match(/['"`]https?:\/\/[^'"`]+['"`]/g) || []).filter((u) => !/instagram\.com|example/.test(u));
    assert.deepEqual(abs, [], f);
  }
});
