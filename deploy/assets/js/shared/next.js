// The only places /login?next= may send a browser. Anything else is ignored.
//
//   /tour/<slug>                       the experience page the visitor came from
//   /booking/result?ref=CHK-12345      the payment result of their own booking
//
// The rule is deliberately a pair of anchored regexes with no way to name another host,
// a protocol-relative URL, a traversal segment, a fragment, extra query parameters or whitespace.
export const TOUR_NEXT_RE = /^\/tour\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const BOOKING_REF_RE = /^CHK-\d{5}$/;
export const RESULT_NEXT_RE = /^\/booking\/result\?ref=CHK-\d{5}$/;

/** Returns `value` when it is an allowed post-login destination, else null. */
export function safeNext(value) {
  if (typeof value !== 'string') return null;
  return TOUR_NEXT_RE.test(value) || RESULT_NEXT_RE.test(value) ? value : null;
}

export const resultHref = (ref) => (BOOKING_REF_RE.test(String(ref)) ? `/booking/result?ref=${ref}` : null);
