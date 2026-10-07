// How a tour is reserved, and the one place that decides what a reservation link may be.
// Used by the server (validation when the admin saves a tour; the page model re-checks what it
// reads, so a bad stored value can never become a link) and by the page templates.
//
//   online    the site's own booking card and ZarinPal payment (only while BOOKING_ONLINE_ENABLED is on)
//   external  dates are shown as information and one button leads to booking_url (https:, tel: or mailto:)
//   none      dates and a note only, no button
export const BOOKING_MODES = ['online', 'external', 'none'];
export const BOOKING_LIMITS = { url: 300, label: 40, note: 200 };
export const DEFAULT_BOOKING_LABEL = 'رزرو';
export const ONLINE_SOON_TEXT = 'رزرو آنلاین به‌زودی فعال می‌شود';

export const isBookingMode = (v) => typeof v === 'string' && BOOKING_MODES.includes(v);

// No whitespace, control characters, quotes, angle brackets, backticks or backslashes anywhere in a link.
const UNSAFE_URL_CHARS = /[\s\u0000-\u001f\u007f-\u009f"'<>`\\\u2028\u2029]/;
const TEL = /^tel:\+?[0-9()\-.]{3,30}$/i;
const MAILTO = /^mailto:[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?:\?[A-Za-z0-9._~%!$&()*+,;=:@/?-]*)?$/i;

/**
 * Checks a reservation link. Only https://, tel: and mailto: pass; javascript:, data:, http:, //host,
 * relative paths, credentials in the URL and anything with whitespace or markup characters do not.
 * Returns { ok: true, value, kind: 'https' | 'tel' | 'mailto' } (the scheme in lower case) or
 * { ok: false, error: 'type' | 'length' | 'format' | 'scheme' }.
 */
export function checkBookingUrl(input) {
  if (typeof input !== 'string') return { ok: false, error: 'type' };
  const s = input.trim();
  if (s.length > BOOKING_LIMITS.url) return { ok: false, error: 'length' };
  if (!s || UNSAFE_URL_CHARS.test(s)) return { ok: false, error: 'format' };

  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(s);
  const name = scheme ? scheme[1].toLowerCase() : '';
  if (name === 'tel') return TEL.test(s) && /\d.*\d.*\d/.test(s) ? { ok: true, value: `tel:${s.slice(4)}`, kind: 'tel' } : { ok: false, error: 'format' };
  if (name === 'mailto') return MAILTO.test(s) ? { ok: true, value: `mailto:${s.slice(7)}`, kind: 'mailto' } : { ok: false, error: 'format' };
  if (name !== 'https') return { ok: false, error: 'scheme' };

  if (!/^https:\/\/[^/?#]/i.test(s)) return { ok: false, error: 'format' };
  let u;
  try { u = new URL(s); } catch { return { ok: false, error: 'format' }; }
  if (u.protocol !== 'https:' || !u.hostname || u.username || u.password) return { ok: false, error: 'format' };
  return { ok: true, value: `https:${s.slice(6)}`, kind: 'https' };
}

/** { href, newTab } for a stored link, or null when it is not a valid reservation link. https opens in a new tab. */
export function bookingLink(url) {
  const c = checkBookingUrl(url);
  return c.ok ? { href: c.value, newTab: c.kind === 'https' } : null;
}

/** Plain one-line text (label, note): whitespace collapsed, empty -> null; control characters are not text. */
export function checkBookingText(input, max) {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== 'string') return { ok: false, error: 'type' };
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u2028\u2029]/.test(input)) return { ok: false, error: 'format' };
  const s = input.replace(/\s+/g, ' ').trim();
  if (s.length > max) return { ok: false, error: 'length' };
  return { ok: true, value: s || null };
}
