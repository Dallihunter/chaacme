// Escaping tagged template used by every public template.
//
//   html`<p title="${title}">${text}</p>`
//
// Every interpolated value is HTML-escaped, which is safe in text AND in
// double- or single-quoted attribute values (& < > " ' are all escaped).
// Attributes in templates must therefore always be quoted.
//
// What an interpolation may be:
//   - a string / number          escaped
//   - null / undefined / false   rendered as nothing (so `${cond && html`..`}` works)
//   - the result of html``       inserted as-is (it was already escaped when built)
//   - an array                   each item handled by these same rules, concatenated
//
// raw() exists for the one case the rules above cannot express and still
// refuses anything that is not template output: it accepts the value returned
// by html`` (or join()) and nothing else, so a plain string can never be marked
// "trusted" by accident.

class SafeHtml {
  constructor(value) { this.value = value; Object.freeze(this); }
  toString() { return this.value; }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

function render(value) {
  if (value == null || value === false || value === true) return '';
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return escapeHtml(value);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new SafeHtml(out);
}

/** Marks already-rendered template output as safe. Throws for anything else. */
export function raw(value) {
  if (!(value instanceof SafeHtml)) throw new TypeError('raw() only accepts the output of html``');
  return value;
}

/** Joins template outputs / strings (strings are escaped) with a separator that is itself escaped text. */
export function join(items, separator = '') {
  const sep = escapeHtml(separator);
  return new SafeHtml(items.map(render).filter((s) => s !== '').join(sep));
}

export const isSafeHtml = (value) => value instanceof SafeHtml;

/** Final string of a template result (what the server sends / the client parses). */
export function toHtmlString(value) { return render(value); }

const SITE_PATH = /^\/(?!\/)[^\s\\]*$/;

/**
 * For href / src values built from data. Only same-site absolute paths and
 * http(s) URLs pass; everything else (javascript:, data:, //host, relative
 * junk) becomes `fallback`. Escaping still happens in html``.
 */
export function safeUrl(value, fallback = '#') {
  const s = typeof value === 'string' ? value.trim() : '';
  if (SITE_PATH.test(s)) return s;
  try {
    const u = new URL(s);
    if (u.protocol === 'https:' || u.protocol === 'http:') return s;
  } catch { /* not absolute */ }
  return fallback;
}

/** Joins class names, dropping falsy ones. */
export const cx = (...names) => names.filter(Boolean).join(' ');

/**
 * JSON for a <script type="application/json"> block: `<`, `>` , `&` and the
 * U+2028/2029 line separators are unicode-escaped so no payload can close the tag.
 */
export function jsonForScript(data) {
  return new SafeHtml(JSON.stringify(data)
    .replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029'));
}
