import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, raw, join, safeUrl, jsonForScript, toHtmlString, isSafeHtml } from '../deploy/assets/js/shared/html.js';
import { formatNumberFa, formatDateFa, formatDateRangeFa, toFaDigits } from '../deploy/assets/js/shared/format.js';

const PAYLOAD = `<script>alert("x")</script> & ' "`;

test('html`` escapes < > " \' & in text', () => {
  const out = toHtmlString(html`<p>${PAYLOAD}</p>`);
  assert.equal(out, '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39; &quot;</p>');
});

test('html`` escapes in double- and single-quoted attributes', () => {
  assert.equal(toHtmlString(html`<a title="${'" onmouseover="x'}">`), '<a title="&quot; onmouseover=&quot;x">');
  assert.equal(toHtmlString(html`<a title='${"' onmouseover='x"}'>`), '<a title=\'&#39; onmouseover=&#39;x\'>');
});

test('nested template output is inserted once, never double-escaped; arrays and falsy values behave', () => {
  const inner = html`<b>${'a&b'}</b>`;
  assert.equal(toHtmlString(html`<p>${inner}</p>`), '<p><b>a&amp;b</b></p>');
  assert.equal(toHtmlString(html`<ul>${['<x>', inner].map((v) => html`<li>${v}</li>`)}</ul>`), '<ul><li>&lt;x&gt;</li><li><b>a&amp;b</b></li></ul>');
  assert.equal(toHtmlString(html`[${null}${undefined}${false}${true}${NaN}${0}]`), '[0]');
  assert.equal(toHtmlString(html`${'<'}`), '&lt;');
});

test('a string that looks like markup is escaped even if it came from html``.toString()', () => {
  const s = String(html`<b>x</b>`);
  assert.equal(toHtmlString(html`${s}`), '&lt;b&gt;x&lt;/b&gt;');
});

test('raw() only accepts template output', () => {
  const ok = html`<b>x</b>`;
  assert.equal(raw(ok), ok);
  assert.ok(isSafeHtml(raw(ok)));
  for (const bad of ['<b>x</b>', 5, null, undefined, {}, { value: '<b>' }, ['<b>']]) assert.throws(() => raw(bad), TypeError);
});

test('join() escapes plain strings and the separator, keeps template output', () => {
  assert.equal(toHtmlString(join(['<a>', html`<i>b</i>`], '<br>')), '&lt;a&gt;&lt;br&gt;<i>b</i>');
});

test('safeUrl allows site paths and http(s) only', () => {
  for (const ok of ['/tour/x', '/images/a/b.jpg', 'https://example.com/a', 'http://example.com']) assert.equal(safeUrl(ok), ok);
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', '//evil.example/x', '', null, undefined, 'relative/path', '/a b', '\\\\evil', 'vbscript:x']) {
    assert.equal(safeUrl(bad), '#', String(bad));
  }
  assert.equal(safeUrl('javascript:1', ''), '');
});

test('jsonForScript cannot close the script tag', () => {
  const out = toHtmlString(jsonForScript({ a: '</script><!--', b: ' &' }));
  assert.ok(!out.includes('</script>') && !out.includes('<'));
  assert.deepEqual(JSON.parse(out), { a: '</script><!--', b: ' &' });
});

test('format: Persian digits, separators, Jalali dates, no NaN', () => {
  assert.equal(formatNumberFa(23000000), '۲۳٬۰۰۰٬۰۰۰');
  assert.equal(toFaDigits('12:30'), '۱۲:۳۰');
  assert.equal(formatNumberFa(NaN), '');
  assert.equal(formatNumberFa(null), '');
  assert.equal(formatNumberFa(undefined), '');
  assert.equal(formatDateFa('2026-10-30'), '۸ آبان ۱۴۰۵');
  assert.equal(formatDateRangeFa('2026-10-30', '2026-11-01'), '۸ تا ۱۰ آبان ۱۴۰۵');
  assert.equal(formatDateRangeFa('2026-10-30', '2026-10-30'), '۸ آبان ۱۴۰۵');
  assert.equal(formatDateRangeFa('2026-10-25', '2026-10-27'), '۳ تا ۵ آبان ۱۴۰۵');
  assert.equal(formatDateRangeFa('2026-10-20', '2026-11-02'), '۲۸ مهر تا ۱۱ آبان ۱۴۰۵');
  for (const bad of [null, undefined, '', 'x', '2026-13-45']) assert.equal(formatDateFa(bad), '', String(bad));
});
