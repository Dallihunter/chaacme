import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../deploy/admin-index.html', import.meta.url), 'utf8');

// The admin speaks Persian. Technical words (alt, slug, URL, Instagram, tel…) may appear inside Persian text; what must not
// reappear is an English sentence or label: two or more consecutive Latin words in a label, button, heading, table
// header, placeholder, title, toast, prompt or message.
test('no English UI text left in the admin (labels, buttons, headings, table headers, toasts, prompts)', () => {
  const found = [];
  const lines = src.split('\n');
  const patterns = [/>([^<>]*)</g, /toast\('([^']*)'/g, /textContent = '([^']*)'/g, /(?:placeholder|title|aria-label)="([^"]*)"/g, /(?:confirm|prompt)\('([^']*)'/g, /label:\s*'([^']*)'/g];
  lines.forEach((line, i) => {
    if (i < 150) return; // markup/CSS head
    for (const re of patterns) {
      for (const m of line.matchAll(re)) {
        const t = m[1].replace(/&[a-z]+;/g, ' ').replace(/' \+ [^+]*\+ '/g, ' ').trim();
        // a run of two English words, ignoring URLs, paths, ids and examples
        const run = t.replace(/https?:\/\/\S+|\/[A-Za-z0-9_./<>&;-]+|[a-z]+-[a-z-]+|e\.g\./g, ' ').match(/[A-Za-z]{2,}(?:[ ,]+[A-Za-z]{2,})+/);
        if (run && !/^(alt|slug|URL|JPG|PNG|WebP|mp4|tel|HTML|Instagram|ZarinPal)(\s|$)/.test(run[0]) && !/^[A-Za-z]+ [A-Za-z]+$/.test(run[0]) ) found.push(`${i + 1}: ${t.slice(0, 80)}`);
        else if (run && /\b(the|and|is|are|to|of|for|not|no|you|your|this|that|with|from|first|failed|saved|could|can|please|choose|add|remove|delete|save|cancel|loading)\b/i.test(run[0])) found.push(`${i + 1}: ${t.slice(0, 80)}`);
      }
    }
  });
  assert.deepEqual(found, []);
});

test('the admin is RTL Persian and loads the one stylesheet and the shared header', () => {
  assert.match(src, /<html lang="fa" dir="rtl">/);
  assert.ok(src.includes('/assets/chaacme.css') && src.includes("/assets/js/shared/components/header.js"));
});

test('the admin header links are site paths (/admin/#/...), which every version of safeUrl keeps', async () => {
  const { safeUrl } = await import('../deploy/assets/js/shared/html.js');
  assert.match(src, /href: '\/admin\/' \+ x\[2\]/);
  for (const section of ['tours', 'hosts', 'applications', 'revisions', 'proposals', 'bookings', 'settings']) {
    assert.equal(safeUrl(`/admin/#/${section}`), `/admin/#/${section}`);
    assert.match(src, new RegExp(`'${section}', '[^']+', '#/${section}'`));
  }
});
