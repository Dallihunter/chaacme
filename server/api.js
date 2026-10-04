import * as db from './db.js';
import * as auth from './auth.js';
import * as adminAuth from './adminAuth.js';
import * as zarinpal from './zarinpal.js';
import { handleUpload, deleteUploadedFile } from './upload.js';
import {
  json, readJson, allow, clientIp, hashIp, parseCookies, sessionCookie,
  normalisePhone, validateProfile, validateReview, validatePassword,
  validateHostProfile, validateHostApplication, validateHostMedia, validateUserName,
  isValidHostSlug, validateEditionDates
} from './util.js';

function bearerOrCookieToken(req) {
  const header = req.headers.authorization || '';
  const bearer = /^Bearer\s+(.+)$/i.exec(header);
  if (bearer) return bearer[1].trim();
  return parseCookies(req).chaacme_session || null;
}

function currentUser(req) {
  return auth.getSessionUser(bearerOrCookieToken(req));
}

function requireUser(req, res) {
  const user = currentUser(req);
  if (!user) { json(res, 401, { error: 'unauthorized' }); return null; }
  return user;
}

// The admin panel is a same-origin browser page, so this is cookie-only —
// no Authorization: Bearer fallback (unlike the end-user session above,
// which supports non-browser callers). Keeping the two token lookups
// separate also means an end-user session cookie can never be mistaken for
// an admin one.
function adminToken(req) {
  return parseCookies(req).chaacme_admin_session || null;
}

function currentAdmin(req) {
  return adminAuth.getAdminSessionUser(adminToken(req));
}

const ID = '([A-Za-z0-9_-]+)';
const NUM = '(\\d+)';
const SLUG = '([a-z0-9-]+)';
const TOUR_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

// One fixed response for every accepted application, whether it was stored,
// deduplicated against a pending one, or silently dropped as a honeypot hit.
// Callers learn nothing about which happened.
const APPLICATION_ACCEPTED = { ok: true };

// Where the ZarinPal callback sends the user's browser back to. This service
// is JSON-API-only (see index.js) and has no page of its own to render, so
// this is a redirect to whatever frontend is deployed at FRONTEND_ORIGIN
// (already used for CORS — see index.js) with a relative-path fallback for a
// same-origin deploy where FRONTEND_ORIGIN is left unset.
function bookingResultRedirect(status, extra = {}) {
  const origin = (process.env.FRONTEND_ORIGIN || '').trim();
  const params = new URLSearchParams({ status, ...extra });
  return `${origin}/booking/result?${params.toString()}`;
}

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

export async function handleApi(req, res, url) {
  const path = url.pathname;
  const method = req.method;
  let m;

  // --- catalog ----------------------------------------------------------
  if (path === '/api/tours' && method === 'GET') {
    return json(res, 200, { tours: db.listTours() });
  }

  if ((m = new RegExp(`^/api/tours/${ID}$`).exec(path)) && method === 'GET') {
    const tour = db.getTourDetail(m[1]);
    if (!tour) return json(res, 404, { error: 'not_found' });
    return json(res, 200, { tour });
  }

  if ((m = new RegExp(`^/api/tours/${ID}/reviews$`).exec(path)) && method === 'POST') {
    const user = requireUser(req, res);
    if (!user) return;
    const tour = db.getTourDetail(m[1]);
    if (!tour) return json(res, 404, { error: 'not_found' });

    if (!allow(`review:${user.id}`, 10, 60 * 60 * 1000)) {
      return json(res, 429, { error: 'rate_limited' });
    }
    const body = await readJson(req);
    if (!body.ok) return json(res, 400, { error: body.error });
    const check = validateReview(body.value);
    if (!check.ok) return json(res, 422, { error: 'validation_failed', fields: check.errors });

    const displayName = `${user.firstName} ${user.lastName[0] || ''}.`.trim();
    const review = db.createReview({ tourId: m[1], userId: user.id, displayName, ...check.value });
    return json(res, 201, { ok: true, review: { id: review.id, status: review.status } });
  }

  // --- hosts (organizers) -------------------------------------------------
  if ((m = new RegExp(`^/api/hosts/${SLUG}$`).exec(path)) && method === 'GET') {
    const host = db.getHostBySlug(m[1]);
    if (!host) return json(res, 404, { error: 'not_found' });
    return json(res, 200, { host });
  }

  // Applying is account-bound: the applicant is whoever the session says it
  // is, which is what makes "my applications" and "my profiles" on the
  // account page possible at all, and means a phone number can no longer be
  // typed in on someone else's behalf.
  if (path === '/api/host-applications' && method === 'POST') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    if (!body.ok) return json(res, 400, { error: body.error });

    // Honeypot: a real form leaves this hidden field empty. Bots that fill
    // every input get the same success response as a genuine submission, so
    // they get no signal that they were caught.
    if (str(body.value.website)) return json(res, 201, APPLICATION_ACCEPTED);

    const check = validateHostApplication(body.value);
    if (!check.ok) return json(res, 422, { error: 'validation_failed', fields: check.errors });

    const ipHash = hashIp(clientIp(req));
    if (!allow(`host-app:ip:${ipHash}`, 3, 24 * 60 * 60 * 1000)
      || !allow(`host-app:user:${user.id}`, 3, 24 * 60 * 60 * 1000)) {
      return json(res, 429, { error: 'rate_limited' });
    }

    // One account may legitimately propose several profiles (a coach who
    // also runs a lodge), but not an unbounded queue of them: three awaiting
    // a decision is the cap. Same uniform response as everything else here.
    if (db.pendingApplicationCount(user.id) < 3) {
      db.createHostApplication({ ...check.value, userId: user.id }, ipHash);
    }
    return json(res, 201, APPLICATION_ACCEPTED);
  }

  // --- auth: phone + OTP --------------------------------------------------
  // OTP auth disabled entirely (frontend + backend) — 2026-09-23, explicit
  // product decision accepting that any existing password-less (OTP-only)
  // account can no longer sign in. auth.js/db.js OTP internals (issueOtp,
  // verifyOtp, completeProfile, otp_codes table) are untouched — only these
  // three routes are gated off. Re-enable by flipping this back to false
  // (and the matching OTP_LOGIN_DISABLED flag in frontend/index.html) and
  // redeploying both.
  const OTP_AUTH_DISABLED = true;
  if (OTP_AUTH_DISABLED && method === 'POST'
    && (path === '/api/auth/otp/request' || path === '/api/auth/otp/verify' || path === '/api/auth/profile')) {
    return json(res, 410, { error: 'otp_disabled' });
  }
  if (path === '/api/auth/otp/request' && method === 'POST') {
    const body = await readJson(req);
    if (!body.ok) return json(res, 400, { error: body.error });
    const phone = normalisePhone(body.value.phone);
    if (!phone) return json(res, 422, { error: 'validation_failed', fields: { phone: 'format' } });

    const ip = clientIp(req);
    if (!allow(`otp:phone:${phone}`, 5, 15 * 60 * 1000) || !allow(`otp:ip:${hashIp(ip)}`, 20, 15 * 60 * 1000)) {
      return json(res, 429, { error: 'rate_limited', message: 'Too many codes requested. Try again later.' });
    }

    const { expiresInSeconds } = await auth.issueOtp(phone);
    return json(res, 202, { ok: true, expiresInSeconds });
  }

  if (path === '/api/auth/otp/verify' && method === 'POST') {
    const body = await readJson(req);
    if (!body.ok) return json(res, 400, { error: body.error });
    const phone = normalisePhone(body.value.phone);
    const code = String(body.value.code || '').trim();
    if (!phone || !/^\d{5}$/.test(code)) {
      return json(res, 422, { error: 'validation_failed', fields: { phone: !phone ? 'format' : undefined, code: !/^\d{5}$/.test(code) ? 'format' : undefined } });
    }

    const ip = clientIp(req);
    if (!allow(`otp-verify:phone:${phone}`, 10, 15 * 60 * 1000) || !allow(`otp-verify:ip:${hashIp(ip)}`, 40, 15 * 60 * 1000)) {
      return json(res, 429, { error: 'rate_limited' });
    }

    const result = auth.verifyOtp(phone, code);
    if (!result.ok) return json(res, 401, { error: result.error });

    if (result.status === 'existing') {
      res.setHeader('set-cookie', sessionCookie(result.sessionToken, { maxAgeSeconds: auth.SESSION_TTL_SECONDS }));
      return json(res, 200, { status: 'existing', user: result.user });
    }
    return json(res, 200, { status: 'new', ticket: result.ticket, expiresInSeconds: result.expiresInSeconds });
  }

  if (path === '/api/auth/profile' && method === 'POST') {
    const body = await readJson(req);
    if (!body.ok) return json(res, 400, { error: body.error });
    const check = validateProfile(body.value);
    if (!check.ok) return json(res, 422, { error: 'validation_failed', fields: check.errors });

    const result = auth.completeProfile(body.value.ticket, check.value);
    if (!result.ok) {
      const status = result.error === 'invalid_ticket' || result.error === 'ticket_expired' ? 401
        : result.error === 'already_exists' ? 409 : 400;
      return json(res, status, { error: result.error });
    }

    res.setHeader('set-cookie', sessionCookie(result.sessionToken, { maxAgeSeconds: auth.SESSION_TTL_SECONDS }));
    return json(res, 201, { ok: true, user: result.user });
  }

  // --- auth: phone + password (runs alongside OTP, same users table/sessions) --
  if (path === '/api/auth/signup' && method === 'POST') {
    const body = await readJson(req);
    if (!body.ok) return json(res, 400, { error: body.error });
    const phone = normalisePhone(body.value.phone);
    if (!phone) return json(res, 422, { error: 'validation_failed', fields: { phone: 'format' } });

    const profileCheck = validateProfile(body.value);
    const passwordCheck = validatePassword(body.value.password);
    if (!profileCheck.ok || !passwordCheck.ok) {
      return json(res, 422, {
        error: 'validation_failed',
        fields: { ...(profileCheck.ok ? {} : profileCheck.errors), ...(passwordCheck.ok ? {} : passwordCheck.errors) }
      });
    }

    const ip = clientIp(req);
    if (!allow(`signup:ip:${hashIp(ip)}`, 10, 15 * 60 * 1000) || !allow(`signup:phone:${phone}`, 5, 15 * 60 * 1000)) {
      return json(res, 429, { error: 'rate_limited' });
    }

    const result = auth.signupWithPassword({ phone, ...profileCheck.value, password: passwordCheck.value });
    if (!result.ok) {
      return json(res, result.error === 'already_exists' ? 409 : 400, { error: result.error });
    }

    res.setHeader('set-cookie', sessionCookie(result.sessionToken, { maxAgeSeconds: auth.SESSION_TTL_SECONDS }));
    return json(res, 201, { ok: true, user: result.user });
  }

  if (path === '/api/auth/login' && method === 'POST') {
    const body = await readJson(req);
    if (!body.ok) return json(res, 400, { error: body.error });
    const phone = normalisePhone(body.value.phone);
    const password = String(body.value.password || '');
    if (!phone || !password) return json(res, 422, { error: 'validation_failed' });

    const ip = clientIp(req);
    if (!allow(`login:phone:${phone}`, 10, 15 * 60 * 1000) || !allow(`login:ip:${hashIp(ip)}`, 30, 15 * 60 * 1000)) {
      return json(res, 429, { error: 'rate_limited' });
    }

    const result = auth.loginWithPassword(phone, password);
    if (!result.ok) return json(res, 401, { error: 'invalid_credentials' });

    res.setHeader('set-cookie', sessionCookie(result.sessionToken, { maxAgeSeconds: auth.SESSION_TTL_SECONDS }));
    return json(res, 200, { ok: true, user: result.user });
  }

  if (path === '/api/auth/me' && method === 'GET') {
    const user = currentUser(req);
    if (!user) return json(res, 401, { error: 'unauthorized' });
    return json(res, 200, { user });
  }

  if (path === '/api/auth/me' && method === 'PUT') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    if (!body.ok) return json(res, 400, { error: body.error });
    const check = validateUserName(body.value);
    if (!check.ok) return json(res, 422, { error: 'validation_failed', fields: check.errors });
    const updated = db.updateUserName(user.id, check.value);
    if (!updated) return json(res, 404, { error: 'not_found' });
    return json(res, 200, { ok: true, user: updated });
  }

  // --- the signed-in user's own partner data ------------------------------
  //
  // Every one of these scopes on user.id from the session. None of them
  // accepts a user id, a slug or any other selector from the client, so
  // there is nothing here for one account to point at another's data with.
  if (path === '/api/me/applications' && method === 'GET') {
    const user = requireUser(req, res);
    if (!user) return;
    return json(res, 200, { applications: db.listUserApplications(user.id) });
  }

  if (path === '/api/me/profiles' && method === 'GET') {
    const user = requireUser(req, res);
    if (!user) return;
    return json(res, 200, { profiles: db.listUserProfiles(user.id) });
  }

  if (path === '/api/me/reviews' && method === 'GET') {
    const user = requireUser(req, res);
    if (!user) return;
    return json(res, 200, { reviews: db.listUserReviews(user.id) });
  }

  if (path === '/api/auth/logout' && method === 'POST') {
    auth.revokeSession(bearerOrCookieToken(req));
    res.setHeader('set-cookie', sessionCookie('', { clear: true }));
    return json(res, 200, { ok: true });
  }

  // --- bookings -----------------------------------------------------------
  if (path === '/api/bookings' && method === 'POST') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    if (!body.ok) return json(res, 400, { error: body.error });

    const tourId = String(body.value.tourId || '');
    const tourDateId = Number(body.value.tourDateId);
    const guests = Number(body.value.guests);
    if (!tourId || !Number.isInteger(tourDateId) || !Number.isInteger(guests) || guests < 1 || guests > 8) {
      return json(res, 422, { error: 'validation_failed' });
    }

    if (!allow(`booking:${user.id}`, 20, 60 * 60 * 1000)) {
      return json(res, 429, { error: 'rate_limited' });
    }

    try {
      const booking = db.createBooking({ userId: user.id, tourId, tourDateId, guests });
      return json(res, 201, { ok: true, booking: { id: booking.id, ref: booking.ref, total: booking.total, status: booking.status } });
    } catch (err) {
      if (err instanceof db.BookingError) {
        const status = (err.code === 'not_enough_seats' || err.code === 'date_in_past') ? 409 : 404;
        return json(res, status, { error: err.code });
      }
      throw err;
    }
  }

  if (path === '/api/bookings/me' && method === 'GET') {
    const user = requireUser(req, res);
    if (!user) return;
    return json(res, 200, { bookings: db.getUserBookings(user.id) });
  }

  // --- payments: ZarinPal ---------------------------------------------------
  //
  // Amount is always derived server-side from the stored booking (`total`,
  // in Toman) — never from anything the client sends — and converted to
  // Rial only at the point of building the ZarinPal payload (zarinpal.js).
  if (path === '/api/payments/zarinpal/request' && method === 'POST') {
    const user = requireUser(req, res);
    if (!user) return;
    const body = await readJson(req);
    if (!body.ok) return json(res, 400, { error: body.error });

    const bookingId = Number(body.value.bookingId);
    if (!Number.isInteger(bookingId)) return json(res, 422, { error: 'validation_failed' });

    const booking = db.getBookingWithTourName(bookingId);
    if (!booking || booking.user_id !== user.id) return json(res, 404, { error: 'not_found' });
    if (booking.payment_status !== 'pending') {
      return json(res, 400, { error: 'not_payable', paymentStatus: booking.payment_status });
    }

    if (!allow(`zarinpal-request:${user.id}`, 20, 60 * 60 * 1000)) {
      return json(res, 429, { error: 'rate_limited' });
    }

    try {
      const { authority, redirectUrl } = await zarinpal.requestPayment({
        amountToman: booking.total,
        description: `${booking.tourName} — ${booking.ref}`,
        mobile: user.phone,
        orderId: booking.ref
      });
      db.setBookingAuthority(booking.id, authority);
      return json(res, 200, { ok: true, redirectUrl });
    } catch (err) {
      // Never forward ZarinPal's raw response (may carry merchant id/amount
      // details) to the client — log it server-side for debugging instead.
      console.error('[chaacme-platform] zarinpal request failed for booking', booking.id, err.code, err.raw);
      return json(res, 502, { error: 'payment_gateway_error' });
    }
  }

  if (path === '/api/payments/zarinpal/callback' && method === 'GET') {
    const authority = url.searchParams.get('Authority') || '';
    const status = url.searchParams.get('Status') || '';
    const booking = authority ? db.getBookingByAuthority(authority) : null;
    if (!booking) return redirect(res, bookingResultRedirect('error'));

    // Idempotent: ZarinPal (or the user's browser) may hit this callback more
    // than once for the same authority. Once a booking has left 'pending' it
    // is never reprocessed — just redirect to whatever the stored outcome is.
    if (booking.payment_status !== 'pending') {
      const resultStatus = booking.payment_status === 'paid' ? 'success'
        : booking.payment_status === 'paid_no_capacity' ? 'no_capacity' : 'failed';
      return redirect(res, bookingResultRedirect(resultStatus, { ref: booking.ref }));
    }

    if (status !== 'OK') {
      db.markBookingPaymentFailed(booking.id);
      return redirect(res, bookingResultRedirect('failed', { ref: booking.ref }));
    }

    try {
      const { refId } = await zarinpal.verifyPayment({ amountToman: booking.total, authority });
      const { booking: updated } = db.confirmBookingPayment(booking.id, { refId });
      const resultStatus = updated.payment_status === 'paid' ? 'success' : 'no_capacity';
      return redirect(res, bookingResultRedirect(resultStatus, { ref: booking.ref }));
    } catch (err) {
      console.error('[chaacme-platform] zarinpal verify failed for booking', booking.id, err.code, err.raw);
      db.markBookingPaymentFailed(booking.id);
      return redirect(res, bookingResultRedirect('failed', { ref: booking.ref }));
    }
  }

  // --- admin ----------------------------------------------------------------
  if (path.startsWith('/api/admin/')) {
    // Login/logout must be reachable without an existing admin session —
    // everything else below this block requires one.
    if (path === '/api/admin/login' && method === 'POST') {
      const body = await readJson(req);
      if (!body.ok) return json(res, 400, { error: body.error });
      const username = String(body.value.username || '').trim();
      const password = String(body.value.password || '');

      const ip = clientIp(req);
      if (!allow(`admin-login:ip:${hashIp(ip)}`, 10, 15 * 60 * 1000)
        || !allow(`admin-login:user:${username}`, 10, 15 * 60 * 1000)) {
        return json(res, 429, { error: 'rate_limited' });
      }

      const token = username && password ? adminAuth.adminLogin(username, password) : null;
      if (!token) return json(res, 401, { error: 'invalid_credentials' });

      res.setHeader('set-cookie', sessionCookie(token, {
        name: 'chaacme_admin_session', maxAgeSeconds: adminAuth.ADMIN_SESSION_TTL_SECONDS
      }));
      return json(res, 200, { ok: true });
    }
    if (path === '/api/admin/logout' && method === 'POST') {
      adminAuth.revokeAdminSession(adminToken(req));
      res.setHeader('set-cookie', sessionCookie('', { name: 'chaacme_admin_session', clear: true }));
      return json(res, 200, { ok: true });
    }

    const admin = currentAdmin(req);
    if (!admin) return json(res, 401, { error: 'unauthorized' });

    if (path === '/api/admin/me' && method === 'GET') {
      return json(res, 200, { admin });
    }

    if (path === '/api/admin/tours' && method === 'GET') {
      return json(res, 200, { tours: db.listToursAdmin() });
    }
    if (path === '/api/admin/tours' && method === 'POST') {
      const body = await readJson(req, 64 * 1024);
      if (!body.ok) return json(res, 400, { error: body.error });
      const id = String(body.value.id || '');
      if (!TOUR_ID_RE.test(id)) {
        return json(res, 422, { error: 'validation_failed', fields: { id: 'format' } });
      }
      if (!body.value.name) return json(res, 422, { error: 'validation_failed', fields: { name: 'required' } });
      if (db.tourExists(id)) return json(res, 409, { error: 'id_taken' });
      return json(res, 201, { tour: db.createTour({ ...body.value, id }) });
    }
    if ((m = new RegExp(`^/api/admin/tours/${ID}$`).exec(path)) && method === 'GET') {
      const tour = db.getTourDetailAdmin(m[1]);
      if (!tour) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { tour });
    }
    if ((m = new RegExp(`^/api/admin/tours/${ID}$`).exec(path)) && method === 'PUT') {
      if (!db.tourExists(m[1])) return json(res, 404, { error: 'not_found' });
      const body = await readJson(req, 64 * 1024);
      if (!body.ok) return json(res, 400, { error: body.error });
      return json(res, 200, { tour: db.updateTour(m[1], body.value) });
    }
    if ((m = new RegExp(`^/api/admin/tours/${ID}$`).exec(path)) && method === 'DELETE') {
      if (!db.tourExists(m[1])) return json(res, 404, { error: 'not_found' });
      try {
        db.deleteTour(m[1]);
      } catch (err) {
        if (err instanceof db.TourDeleteError) return json(res, 409, { error: err.code });
        throw err;
      }
      return json(res, 200, { ok: true });
    }
    if ((m = new RegExp(`^/api/admin/tours/${ID}/gallery/${NUM}$`).exec(path)) && method === 'DELETE') {
      const imagePath = db.deleteTourMedia(m[1], Number(m[2]));
      if (imagePath === undefined) return json(res, 404, { error: 'not_found' });
      if (imagePath) deleteUploadedFile(imagePath);
      return json(res, 200, { ok: true });
    }
    if ((m = new RegExp(`^/api/admin/tours/${ID}/gallery/reorder$`).exec(path)) && method === 'PUT') {
      if (!db.tourExists(m[1])) return json(res, 404, { error: 'not_found' });
      const body = await readJson(req);
      if (!body.ok) return json(res, 400, { error: body.error });
      const order = Array.isArray(body.value.order) ? body.value.order.map(Number) : null;
      if (!order || order.some((n) => !Number.isInteger(n))) {
        return json(res, 422, { error: 'validation_failed' });
      }
      try {
        return json(res, 200, { media: db.reorderTourMedia(m[1], order) });
      } catch {
        return json(res, 422, { error: 'order_mismatch' });
      }
    }
    if ((m = new RegExp(`^/api/admin/tours/${ID}/dates$`).exec(path)) && method === 'GET') {
      if (!db.tourExists(m[1])) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { dates: db.listEditionsAdmin(m[1]) });
    }
    if ((m = new RegExp(`^/api/admin/tours/${ID}/dates$`).exec(path)) && method === 'POST') {
      const body = await readJson(req);
      if (!body.ok) return json(res, 400, { error: body.error });
      const { label, capacity } = body.value;
      if (!label || !Number.isInteger(capacity) || capacity < 0) return json(res, 422, { error: 'validation_failed' });
      const dates = validateEditionDates(body.value);
      if (!dates.ok) return json(res, 422, { error: 'validation_failed', fields: dates.errors });
      return json(res, 201, { date: db.addTourDate(m[1], { label, capacity, ...dates.value }) });
    }
    if ((m = new RegExp(`^/api/admin/tour-dates/${NUM}$`).exec(path)) && method === 'PUT') {
      const body = await readJson(req);
      if (!body.ok) return json(res, 400, { error: body.error });
      const id = Number(m[1]);
      const v = body.value;
      if (('capacity' in v && (!Number.isInteger(v.capacity) || v.capacity < 0)) ||
          ('label' in v && (typeof v.label !== 'string' || !v.label.trim()))) {
        return json(res, 422, { error: 'validation_failed' });
      }
      const current = db.getTourDate(id);
      if (!current) return json(res, 404, { error: 'not_found' });
      const dates = validateEditionDates(body.value, { startsOn: current.starts_on, endsOn: current.ends_on });
      if (!dates.ok) return json(res, 422, { error: 'validation_failed', fields: dates.errors });
      return json(res, 200, { date: db.updateTourDate(id, { ...body.value, ...dates.value }) });
    }

    if (path === '/api/admin/reviews' && method === 'GET') {
      const status = url.searchParams.get('status') || undefined;
      return json(res, 200, { reviews: db.listReviewsAdmin(status) });
    }
    if ((m = new RegExp(`^/api/admin/reviews/${NUM}$`).exec(path)) && method === 'PUT') {
      const body = await readJson(req);
      if (!body.ok) return json(res, 400, { error: body.error });
      if (!['published', 'rejected', 'pending'].includes(body.value.status)) {
        return json(res, 422, { error: 'validation_failed' });
      }
      return json(res, 200, { review: db.setReviewStatus(Number(m[1]), body.value.status) });
    }
    if ((m = new RegExp(`^/api/admin/reviews/${NUM}$`).exec(path)) && method === 'DELETE') {
      const deleted = db.deleteReview(Number(m[1]));
      if (!deleted) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { review: deleted });
    }

    if (path === '/api/admin/bookings' && method === 'GET') {
      const paymentStatus = url.searchParams.get('payment_status') || undefined;
      const limit = url.searchParams.get('limit') || undefined;
      return json(res, 200, { bookings: db.listBookingsAdmin({ paymentStatus, limit }) });
    }
    if ((m = new RegExp(`^/api/admin/bookings/${NUM}$`).exec(path)) && method === 'PUT') {
      const body = await readJson(req);
      if (!body.ok) return json(res, 400, { error: body.error });
      if (!['pending_payment', 'confirmed', 'cancelled'].includes(body.value.status)) {
        return json(res, 422, { error: 'validation_failed' });
      }
      return json(res, 200, { booking: db.setBookingStatus(Number(m[1]), body.value.status) });
    }

    if (path === '/api/admin/users' && method === 'GET') {
      return json(res, 200, { users: db.listUsersAdmin() });
    }

    // --- admin: host applications ----------------------------------------
    if (path === '/api/admin/host-applications' && method === 'GET') {
      const status = url.searchParams.get('status');
      if (status && !['pending', 'approved', 'rejected'].includes(status)) {
        return json(res, 422, { error: 'validation_failed', fields: { status: 'value' } });
      }
      return json(res, 200, { applications: db.listHostApplications(status || null) });
    }

    if ((m = new RegExp(`^/api/admin/host-applications/${NUM}/approve$`).exec(path)) && method === 'POST') {
      const body = await readJson(req);
      if (!body.ok) return json(res, 400, { error: body.error });
      const slug = str(body.value.slug);
      if (!isValidHostSlug(slug)) {
        return json(res, 422, { error: 'validation_failed', fields: { slug: 'format' } });
      }
      const result = db.approveHostApplication(Number(m[1]), slug);
      if (!result.ok) {
        return json(res, result.error === 'slug_taken' ? 409 : 404, { error: result.error });
      }
      return json(res, 200, { ok: true, host: db.getHostAdmin(result.hostId) });
    }

    if ((m = new RegExp(`^/api/admin/host-applications/${NUM}/reject$`).exec(path)) && method === 'POST') {
      const body = await readJson(req);
      if (!body.ok) return json(res, 400, { error: body.error });
      const note = str(body.value.adminNote);
      if (note.length > 2000) return json(res, 422, { error: 'validation_failed', fields: { adminNote: 'length' } });
      const application = db.rejectHostApplication(Number(m[1]), note || null);
      if (!application) return json(res, 404, { error: 'not_pending' });
      return json(res, 200, { ok: true, application });
    }

    // --- admin: hosts -----------------------------------------------------
    if (path === '/api/admin/hosts' && method === 'GET') {
      return json(res, 200, { hosts: db.listHostsAdmin() });
    }

    if (path === '/api/admin/hosts' && method === 'POST') {
      const body = await readJson(req);
      if (!body.ok) return json(res, 400, { error: body.error });
      const slug = str(body.value.slug);
      if (!isValidHostSlug(slug)) {
        return json(res, 422, { error: 'validation_failed', fields: { slug: 'format' } });
      }
      if (db.hostSlugExists(slug)) return json(res, 409, { error: 'slug_taken' });
      const check = validateHostProfile(body.value);
      if (!check.ok) return json(res, 422, { error: 'validation_failed', fields: check.errors });
      // A profile may be attached to an account at creation time (the approve
      // flow does this); an admin-created one usually has no owner.
      const ownerId = Number(body.value.userId);
      const userId = Number.isInteger(ownerId) && ownerId > 0 ? ownerId : null;
      return json(res, 201, { host: db.createHost({ slug, userId, ...check.value }) });
    }

    if ((m = new RegExp(`^/api/admin/hosts/${NUM}$`).exec(path)) && method === 'GET') {
      const host = db.getHostAdmin(Number(m[1]));
      if (!host) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { host });
    }

    // The slug is immutable: it is the public URL of a profile that may
    // already be linked to from elsewhere, so it is set once at create time
    // and never taken from this payload.
    if ((m = new RegExp(`^/api/admin/hosts/${NUM}$`).exec(path)) && method === 'PUT') {
      const existing = db.getHostAdmin(Number(m[1]));
      if (!existing) return json(res, 404, { error: 'not_found' });
      const body = await readJson(req);
      if (!body.ok) return json(res, 400, { error: body.error });
      // kind is fixed at create time, like the slug: it is read from the
      // stored row, never from the payload, so a PUT cannot turn a person
      // into a place (which would strand every field the other kind uses).
      const check = validateHostProfile({ ...body.value, kind: existing.kind });
      if (!check.ok) return json(res, 422, { error: 'validation_failed', fields: check.errors });
      const host = db.updateHost(Number(m[1]), check.value);
      if (!host) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { host });
    }

    // Gallery for a profile — replace-all in one transaction, same contract
    // as the tour host list below.
    if ((m = new RegExp(`^/api/admin/hosts/${NUM}/media$`).exec(path)) && method === 'PUT') {
      const hostId = Number(m[1]);
      if (!db.getHostAdmin(hostId)) return json(res, 404, { error: 'not_found' });
      const body = await readJson(req, 64 * 1024);
      if (!body.ok) return json(res, 400, { error: body.error });
      const check = validateHostMedia(body.value.media);
      if (!check.ok) return json(res, 422, { error: 'validation_failed', fields: check.errors });
      return json(res, 200, { media: db.setHostMedia(hostId, check.value, deleteUploadedFile) });
    }

    // The admin panel needs to read a tour's current organizers back before it
    // can edit them; the PUT below only returns the list it just wrote.
    if ((m = new RegExp(`^/api/admin/tours/${ID}/hosts$`).exec(path)) && method === 'GET') {
      if (!db.tourExists(m[1])) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { hosts: db.tourHostsAdmin(m[1]) });
    }

    // Replaces a tour's whole host list in one transaction.
    if ((m = new RegExp(`^/api/admin/tours/${ID}/hosts$`).exec(path)) && method === 'PUT') {
      const tourId = m[1];
      if (!db.tourExists(tourId)) return json(res, 404, { error: 'not_found' });
      const body = await readJson(req);
      if (!body.ok) return json(res, 400, { error: body.error });
      if (!Array.isArray(body.value.hosts)) {
        return json(res, 422, { error: 'validation_failed', fields: { hosts: 'type' } });
      }
      const ids = body.value.hosts.map((raw) => Number(raw.hostId));
      if (ids.some((id) => !Number.isInteger(id))) {
        return json(res, 422, { error: 'validation_failed', fields: { hostId: 'unknown' } });
      }
      const known = db.hostKindsById(ids);

      const entries = [];
      for (const raw of body.value.hosts) {
        const hostId = Number(raw.hostId);
        const info = known.get(hostId);
        if (!info) return json(res, 422, { error: 'validation_failed', fields: { hostId: 'unknown' } });
        if (entries.some((e) => e.hostId === hostId)) {
          return json(res, 422, { error: 'validation_failed', fields: { hostId: 'duplicate' } });
        }

        // Role and kind have to agree. A place is where the tour happens
        // ('venue'); people run it ('lead'/'co_host'). Letting a lodge be a
        // "co-host" or a coach be the "venue" would make the tour page say
        // something untrue about both of them, so it is a 422, not a silent
        // coercion into whatever role happens to be the default.
        const role = raw.role === 'venue' ? 'venue' : (raw.role === 'co_host' ? 'co_host' : 'lead');
        if (info.kind === 'place' && role !== 'venue') {
          return json(res, 422, { error: 'validation_failed', fields: { role: 'place_must_be_venue' } });
        }
        if (info.kind === 'person' && role === 'venue') {
          return json(res, 422, { error: 'validation_failed', fields: { role: 'person_cannot_be_venue' } });
        }
        // A tour happens in one place.
        if (role === 'venue' && entries.some((e) => e.role === 'venue')) {
          return json(res, 422, { error: 'validation_failed', fields: { role: 'multiple_venues' } });
        }

        entries.push({ hostId, role, sortOrder: Number.isInteger(raw.sortOrder) ? raw.sortOrder : entries.length });
      }
      return json(res, 200, { hosts: db.setTourHosts(tourId, entries) });
    }

    if (path === '/api/admin/upload' && method === 'POST') {
      const result = await handleUpload(req);
      if (!result.ok) return json(res, result.status, { error: result.error });
      return json(res, result.status, { ok: true, path: result.path });
    }
  }

  if (path === '/api/health' && method === 'GET') {
    try {
      db.db.prepare('SELECT 1').get();
      return json(res, 200, { status: 'ok' });
    } catch {
      return json(res, 503, { status: 'error' });
    }
  }

  return json(res, 404, { error: 'not_found' });
}
