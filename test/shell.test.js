import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHtmlString, html } from '../deploy/assets/js/shared/html.js';
import { header } from '../deploy/assets/js/shared/components/header.js';
import { footer } from '../deploy/assets/js/shared/components/footer.js';
import { renderNotFoundPage, renderErrorPage } from '../deploy/assets/js/shared/pages/errors.js';
import { safeNext, resultHref } from '../deploy/assets/js/shared/next.js';

const str = (v) => toHtmlString(v);
const assets = { css: '/assets/chaacme.css?v=1', font: '/assets/fonts/x.woff2', scripts: ['/assets/js/shell.js?v=1'], imports: { '/assets/js/shell.js': '/assets/js/shell.js?v=1' } };

test('header: wordmark, nav, login slot, and a menu that is a <details> (works without JavaScript)', () => {
  const h = str(header({ active: 'become-host', next: '/tour/x' }));
  assert.match(h, /class="ck-latin ck-site-logo">chaacme</);
  assert.match(h, /<details class="ck-menu">/);
  assert.match(h, /<a href="\/login\?next=%2Ftour%2Fx" class="ck-btn ck-btn--secondary ck-btn--sm" data-login-link>ورود<\/a>/);
  assert.match(h, /aria-current="page">همکاری با چکمه/);
  // the menu repeats the links so phones get the same destinations
  assert.equal((h.match(/همکاری با چکمه/g) || []).length, 2);
  assert.ok(h.includes('aria-label="منو"'));
});

test('header variants and escaping', () => {
  assert.match(str(header({ variant: 'overlay' })), /ck-site-header ck-site-header--overlay/);
  assert.match(str(header({ variant: 'overlay-mobile' })), /ck-site-header--overlay-mobile/);
  const panel = str(header({ variant: 'panel', label: 'پنل همکار', authSlot: false, links: [{ href: '/account', label: 'حساب من' }] }));
  assert.ok(panel.includes('ck-site-label">پنل همکار') && !panel.includes('data-auth-slot'));
  const evil = str(header({ authSlot: false, links: [{ href: 'javascript:alert(1)', label: '"><img src=x onerror=1>' }] }));
  assert.ok(!evil.includes('javascript:') && !evil.includes('<img'));
});

test('footer renders only the links it is given', () => {
  assert.ok(!str(footer({})).includes('<nav'));
  const f = str(footer({ links: [{ label: 'حریم خصوصی', href: '/privacy' }, { label: 'اینستاگرام', href: 'https://instagram.com/x' }, { label: 'bad', href: 'javascript:1' }] }));
  assert.ok(f.includes('href="/privacy"') && f.includes('rel="noopener"') && !f.includes('javascript:'));
});

test('404 and error pages: new design, noindex, no detail', () => {
  const nf = renderNotFoundPage({ assets, what: 'این مکان' });
  assert.ok(nf.includes('این مکان پیدا نشد') && nf.includes('noindex') && nf.includes('ck-site-header') && nf.includes('ck-site-footer'));
  assert.ok(nf.includes('/assets/chaacme.css?v=1') && !nf.includes('rel="canonical"'));
  const er = renderErrorPage({ assets });
  assert.ok(er.includes('مشکلی پیش آمد') && er.includes('noindex') && !/stack|Error/.test(er));
});

test('login ?next= allow-list: /tour/<slug> and exactly /booking/result?ref=CHK-NNNNN', () => {
  for (const ok of ['/tour/animal-flow', '/tour/x', '/tour/a1-b2', '/booking/result?ref=CHK-12345']) assert.equal(safeNext(ok), ok, ok);
  const attacks = [
    '//evil.example/x', '///evil.example', '/\\evil.example', '\\\\evil.example', '/\\/evil.example', 'https://evil.example/', 'http://evil.example',
    'javascript:alert(1)', 'data:text/html,x', 'vbscript:x', '/tour/../admin', '/tour/..', '/tour/x/..', '/tour/x/y', '/tour/x?y=1', '/tour/x#y',
    '/tour/x\n', '/tour/x\r\n/evil', '/tour/x%0a', '/tour/x%2f..', '/%2F%2Fevil.example', '/tour//evil.example', '/tour/', '/tour', '/', '', ' /tour/x',
    '/tour/X', '/tour/a_b', '/tour/-a', '/tour/a b', '/admin', '/api/auth/me', '/booking/result', '/tour/x@evil.test', '/tour/x:80',
    // booking result variants that must NOT pass
    '/booking/result?ref=CHK-1234', '/booking/result?ref=CHK-123456', '/booking/result?ref=chk-12345', '/booking/result?ref=CHK-12345&x=1',
    '/booking/result?status=success&ref=CHK-12345', '/booking/result?ref=CHK-12345#x', '/booking/result?ref=CHK-12345\n', '/booking/result?ref=CHK-1234٥',
    '/booking/result/?ref=CHK-12345', '/booking/resultx?ref=CHK-12345', '//booking/result?ref=CHK-12345', '/booking/result?ref=CHK-12345%0a',
    'https://evil.example/booking/result?ref=CHK-12345', '/booking/result?ref=', '/booking/result?ref=CHK-12345 ', null, undefined, 5, {}, ['/tour/x']
  ];
  for (const a of attacks) assert.equal(safeNext(a), null, JSON.stringify(a));
  assert.equal(resultHref('CHK-12345'), '/booking/result?ref=CHK-12345');
  assert.equal(resultHref('CHK-1'), null);
});
