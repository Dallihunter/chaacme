import { mount, app, api, currentUser } from '/assets/js/screens/lib.js';
import { resultView, resultNotFound, resultGatewayError } from '/assets/js/shared/screens/booking.js';
import { BOOKING_REF_RE, resultHref } from '/assets/js/shared/next.js';
import { loginHref } from '/assets/js/shared/site.js';

// /booking/result?ref=CHK-12345 — the ZarinPal callback lands here (with &status=…, which is ignored:
// what is shown comes from the stored booking). Only the signed-in owner can load it.
(async () => {
  const params = new URLSearchParams(location.search);
  const ref = params.get('ref') || '';
  const root = app();
  if (!BOOKING_REF_RE.test(ref)) {
    mount(root, params.get('status') === 'error' ? resultGatewayError() : resultNotFound());
    return;
  }
  if (!(await currentUser())) { location.replace(loginHref(resultHref(ref))); return; }
  const r = await api('GET', `/me/bookings/${encodeURIComponent(ref)}`);
  if (r.status === 401) { location.replace(loginHref(resultHref(ref))); return; }
  mount(root, r.ok && r.data.booking ? resultView(r.data.booking) : resultNotFound());
  const h1 = root.querySelector('h1'); if (h1) { h1.tabIndex = -1; h1.focus(); }
})();
