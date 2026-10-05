import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The SPA's /login?next= handler (deploy/index.html) may only ever send the browser to /tour/<slug> on this site.
// The rule is a single regex; pull the real one out of the shipped file and attack it.
const spa = readFileSync(new URL('../deploy/index.html', import.meta.url), 'utf8');
const m = /const HARD_NEXT_RE = (\/.*\/);/.exec(spa);
assert.ok(m, 'HARD_NEXT_RE present in deploy/index.html');
const RE = new RegExp(m[1].slice(1, -1));

test('login ?next= accepts only /tour/<slug>', () => {
  for (const ok of ['/tour/animal-flow', '/tour/x', '/tour/a1-b2']) assert.ok(RE.test(ok), ok);
  const attacks = [
    '//evil.example/x', '///evil.example', '/\\evil.example', '\\\\evil.example', '/\\/evil.example', 'https://evil.example/', 'http://evil.example',
    'javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '/tour/../admin', '/tour/..', '/tour/x/..', '/tour/x/y', '/tour/x?y=1', '/tour/x#y',
    '/tour/x\n', '/tour/x\r\n/evil', '/tour/x%0a', '/tour/x%2f..', '/%2F%2Fevil.example', '/tour//evil.example', '/tour/', '/tour', '/', '', ' /tour/x',
    '/tour/X', '/tour/a_b', '/tour/-a', '/tour/a--b'.replace('a--b', 'a b'), '/admin', '/api/auth/me', '/booking/result', '/tour/x@evil.test', '/tour/x:80'
  ];
  for (const a of attacks) assert.equal(RE.test(a), false, JSON.stringify(a));
});

test('the next parameter has exactly one reader, and its value only reaches the navigation after the allow-list', () => {
  assert.equal((spa.match(/get\('next'\)/g) || []).length, 1);
  assert.match(spa, /hardNext = next && HARD_NEXT_RE\.test\(next\) \? next : null;/);
  // the only navigations that use hardNext
  assert.match(spa, /window\.location\.replace\(hardNext\)/);
  assert.match(spa, /const back = hardNext;/);
});
