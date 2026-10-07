// The site-wide online booking switch (BOOKING_ONLINE_ENABLED): off by default, and while it is off nobody can
// create a booking or start a payment, and no page offers either. Payments are still the ZarinPal sandbox: a visitor
// must never "pay" and believe they bought a ticket.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'chaacme-sw-'));
const PORT = 6400 + Math.floor(Math.random() * 300);

// a mock ZarinPal that counts what reaches it
const gateway = [];
const mock = createServer((req, res) => {
  req.resume();
  req.on('end', () => {
    gateway.push(req.url);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(req.url.includes('request')
      ? { data: { code: 100, authority: `A${'0'.repeat(35)}${gateway.length}` } }
      : { data: { code: 100, ref_id: 4242 } }));
  });
});
await new Promise((r) => mock.listen(0, '127.0.0.1', r));

delete process.env.BOOKING_ONLINE_ENABLED; // the default under test: OFF
Object.assign(process.env, {
  CHAACME_PLATFORM_DB: join(dir, 't.db'), IP_HASH_SALT: 'x'.repeat(24), OTP_PEPPER: 'y'.repeat(24), FRONTEND_STATIC_DIR: join(dir, 'images'),
  PORT: String(PORT), HOST: '127.0.0.1', FRONTEND_ORIGIN: 'https://example.test', SITE_ORIGIN: 'https://example.test',
  ZARINPAL_BASE_URL_OVERRIDE: `http://127.0.0.1:${mock.address().port}`, ZARINPAL_MERCHANT_ID: '11111111-1111-1111-1111-111111111111',
  ZARINPAL_CALLBACK_URL: 'https://example.test/api/payments/zarinpal/callback'
});
const { server } = await import('../server/index.js');
const db = await import('../server/db.js');
const auth = await import('../server/auth.js');
const adminAuth = await import('../server/adminAuth.js');
const { onlineBookingEnabled } = await import('../server/booking.js');
const { assertRuntimeConfig, describeRuntimeConfig } = await import('../server/util.js');
const { resultView } = await import('../deploy/assets/js/shared/screens/booking.js');
const { toHtmlString } = await import('../deploy/assets/js/shared/html.js');
const base = `http://127.0.0.1:${PORT}`;

before(async () => { if (!server.listening) await new Promise((r) => server.once('listening', r)); });
after(() => { server.close(); mock.close(); });

const ORIGIN = 'https://example.test';
const future = (days) => db.todayIso(new Date(Date.now() + days * 864e5));
const count = (table) => db.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const setSwitch = (v) => { if (v === undefined) delete process.env.BOOKING_ONLINE_ENABLED; else process.env.BOOKING_ONLINE_ENABLED = v; };

const user = db.db.prepare("INSERT INTO users (phone, first_name, last_name, username) VALUES ('09120007001', 'ا', 'ب', 'sw_user')").run().lastInsertRowid;
const token = auth.createSession(Number(user));
const admin = adminAuth.adminLogin((adminAuth.upsertAdminUser('root', 'pw-pw-pw-pw'), 'root'), 'pw-pw-pw-pw');

const call = async (method, path, { body, cookie, headers } = {}) => {
  const res = await fetch(base + path, {
    method, redirect: 'manual',
    headers: { origin: ORIGIN, ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, text, data, res };
};
const asUser = (method, path, body) => call(method, path, { body, cookie: `chaacme_session=${token}` });
const asAdmin = (method, path, body) => call(method, path, { body, cookie: `chaacme_admin_session=${admin}` });

let tourId, dateId, oldBooking;
before(() => {
  db.seed();
  tourId = 'sw-tour';
  db.createTour({ id: tourId, status: 'published', name: 'تور کلید', price: 2000000, duration: '۱ روز', galleryImages: [], galleryPhotos: [] });
  dateId = db.addTourDate(tourId, { label: 'اجرا', capacity: 20, startsOn: future(9) }).id;
  // an old pending booking that already started a gateway session (made before the switch was off)
  oldBooking = db.createBooking({ userId: Number(user), tourId, tourDateId: dateId, guests: 2 });
  db.setBookingAuthority(oldBooking.id, 'A-OLD-SESSION');
});

test('the switch is off unless BOOKING_ONLINE_ENABLED is exactly true or 1 (case and spaces aside)', () => {
  for (const v of [undefined, '', 'false', '0', 'no', 'yes', 'on', 'enabled', 'tru', 'truee']) assert.equal(onlineBookingEnabled({ BOOKING_ONLINE_ENABLED: v }), false, String(v));
  for (const v of ['true', 'TRUE', ' true ', '1']) assert.equal(onlineBookingEnabled({ BOOKING_ONLINE_ENABLED: v }), true, v);
  assert.equal(onlineBookingEnabled({}), false);
  assert.equal(onlineBookingEnabled(), false, 'the process environment of this suite has it unset');
  // the start-up log says which it is, and a typo is called out
  assert.match(describeRuntimeConfig({}).join('\n'), /online booking is OFF \(BOOKING_ONLINE_ENABLED is unset\)/);
  assert.match(describeRuntimeConfig({ BOOKING_ONLINE_ENABLED: 'yes' }).join('\n'), /is "yes", only true or 1 turn it on/);
  assert.match(describeRuntimeConfig({ BOOKING_ONLINE_ENABLED: 'true' }).join('\n'), /BOOKING_ONLINE_ENABLED=true/);
  // on while ZarinPal is in the sandbox is allowed but warned about
  const base = { IP_HASH_SALT: 'x'.repeat(24), OTP_PEPPER: 'y'.repeat(24), FRONTEND_ORIGIN: ORIGIN, ZARINPAL_CALLBACK_URL: `${ORIGIN}/cb`, ZARINPAL_MERCHANT_ID: '11111111-1111-1111-1111-111111111111' };
  assert.ok(assertRuntimeConfig({ ...base, BOOKING_ONLINE_ENABLED: 'true' }).warnings.some((w) => /sandbox payment/.test(w)));
  assert.ok(!assertRuntimeConfig({ ...base }).warnings.some((w) => /sandbox payment/.test(w)));
  assert.ok(!assertRuntimeConfig({ ...base, BOOKING_ONLINE_ENABLED: 'true', ZARINPAL_SANDBOX: 'false' }).warnings.some((w) => /sandbox payment/.test(w)));
});

test('switch off: POST /api/bookings answers 409 online_booking_disabled for everyone, and creates nothing', async () => {
  setSwitch(undefined);
  const before = count('bookings');
  // the deploy's post-check: an anonymous, body-less, same-origin POST
  const anon = await call('POST', '/api/bookings', { body: {} });
  assert.equal(anon.status, 409);
  assert.equal(anon.data.error, 'online_booking_disabled');
  const good = await asUser('POST', '/api/bookings', { tourId, tourDateId: dateId, guests: 1 });
  assert.equal(good.status, 409);
  assert.equal(good.data.error, 'online_booking_disabled');
  for (const v of ['false', '0', '', 'yes']) {
    setSwitch(v);
    assert.equal((await asUser('POST', '/api/bookings', { tourId, tourDateId: dateId, guests: 1 })).status, 409, `BOOKING_ONLINE_ENABLED=${v}`);
  }
  setSwitch(undefined);
  assert.equal(count('bookings'), before, 'no booking row was created');
  assert.equal(gateway.length, 0, 'nothing reached the gateway');
});

test('switch off: payment requests answer 409 and never reach the gateway', async () => {
  setSwitch(undefined);
  const r = await asUser('POST', '/api/payments/zarinpal/request', { bookingId: oldBooking.id });
  assert.equal(r.status, 409);
  assert.equal(r.data.error, 'online_booking_disabled');
  assert.equal((await call('POST', '/api/payments/zarinpal/request', { body: { bookingId: oldBooking.id } })).status, 409, 'anonymous too');
  assert.equal(gateway.length, 0);
  assert.equal(db.getBookingById(oldBooking.id).zarinpal_authority, 'A-OLD-SESSION', 'the stored session is untouched');
});

test('switch off: the gateway callback of an old session confirms nothing and says so', async () => {
  setSwitch(undefined);
  const seatsBefore = db.db.prepare('SELECT seats_taken FROM tour_dates WHERE id = ?').get(dateId).seats_taken;
  const r = await call('GET', '/api/payments/zarinpal/callback?Authority=A-OLD-SESSION&Status=OK');
  assert.equal(r.status, 302);
  assert.equal(r.res.headers.get('location'), `${ORIGIN}/booking/result?status=disabled&ref=${oldBooking.ref}`);
  const row = db.getBookingById(oldBooking.id);
  assert.deepEqual([row.payment_status, row.status, row.zarinpal_ref_id, row.paid_at], ['pending', 'pending_payment', null, null]);
  assert.equal(db.db.prepare('SELECT seats_taken FROM tour_dates WHERE id = ?').get(dateId).seats_taken, seatsBefore, 'no seat was taken');
  assert.equal(gateway.length, 0, 'the payment was not even verified with the gateway');
  // an unknown authority still goes to the error result, as before
  assert.equal((await call('GET', '/api/payments/zarinpal/callback?Authority=nope&Status=OK')).res.headers.get('location'), `${ORIGIN}/booking/result?status=error`);
});

test('switch off: history, the result of an old ref, the admin and health are unaffected (and say the switch is off)', async () => {
  setSwitch(undefined);
  const list = await asUser('GET', '/api/bookings/me');
  assert.equal(list.status, 200);
  assert.equal(list.data.bookings.length, 1);
  const one = await asUser('GET', `/api/me/bookings/${oldBooking.ref}`);
  assert.equal(one.status, 200);
  assert.equal(one.data.booking.ref, oldBooking.ref);
  assert.equal(one.data.onlineBookingOpen, false);
  assert.ok(!('tourBookingMode' in one.data.booking), 'the stored mode is not part of the answer');
  const adm = await asAdmin('GET', '/api/admin/bookings');
  assert.equal(adm.status, 200);
  assert.equal(adm.data.bookings.length, 1);
  assert.equal((await asAdmin('PUT', `/api/admin/bookings/${oldBooking.id}`, { status: 'cancelled' })).status, 200);
  assert.equal((await asAdmin('PUT', `/api/admin/bookings/${oldBooking.id}`, { status: 'pending_payment' })).status, 200);
  assert.equal((await asAdmin('GET', '/api/admin/me')).data.onlineBooking, false);
  const health = await call('GET', '/api/health');
  assert.deepEqual(health.data, { status: 'ok' }, 'the body is what it always was');
  assert.equal(health.res.headers.get('x-online-booking'), 'off');
  // the result page for a pending old booking: no "try again", and it says online booking is off
  const view = toHtmlString(resultView(one.data.booking, { onlineOpen: one.data.onlineBookingOpen }));
  assert.ok(!view.includes('تلاش دوباره برای رزرو'));
  assert.ok(view.includes('رزرو آنلاین فعلاً فعال نیست'));
  const open = toHtmlString(resultView(one.data.booking, { onlineOpen: true }));
  assert.ok(open.includes('تلاش دوباره برای رزرو'), 'with the switch on the old behaviour is unchanged');
});

test('switch off: no page renders a payment form, a booking button or a payment sentence', async () => {
  setSwitch(undefined);
  for (const path of [`/tour/${tourId}`, '/', '/experiences', `/api/pages/tour/${tourId}`]) {
    const { text, status } = await call('GET', path);
    assert.equal(status, 200, path);
    assert.ok(!/<form[^>]*data-booking/.test(text), `${path}: a booking form`);
    assert.ok(!text.includes('data-booking'), path);
    assert.ok(!text.includes('رزرو این تجربه'), `${path}: the booking button`);
    assert.ok(!text.includes('انتخاب تاریخ'), `${path}: the sticky jump button`);
    assert.ok(!text.includes('زرین‌پال') && !/zarinpal/i.test(text), `${path}: a payment sentence`);
    assert.ok(!text.includes('name="edition"'), `${path}: an edition radio`);
  }
  const page = (await call('GET', `/tour/${tourId}`)).text;
  assert.ok(page.includes('رزرو آنلاین به‌زودی فعال می‌شود'), 'the online tour says so');
  assert.match(page, /data-sticky/, 'the mobile bar stays (price and date) but offers no booking');
  const model = (await call('GET', `/api/pages/tour/${tourId}`)).data.page;
  assert.deepEqual([model.booking.mode, model.booking.effective, model.booking.soon, model.booking.link], ['online', 'none', true, null]);
  assert.ok(model.editions.every((e) => e.id === null && e.available === null && e.capacity === null), 'no booking id and no seat data leave the server');
});

test('switch on: the old behaviour is back, end to end (booking -> gateway -> callback)', async () => {
  setSwitch('true');
  try {
    const page = (await call('GET', `/tour/${tourId}`)).text;
    assert.match(page, /<form class="tp-book" id="booking"[^>]*data-booking/);
    assert.ok(page.includes('رزرو این تجربه') && page.includes('پرداخت امن با زرین‌پال'));
    assert.ok(!page.includes('رزرو آنلاین به‌زودی فعال می‌شود'));
    assert.equal((await call('GET', '/api/health')).res.headers.get('x-online-booking'), 'on');

    const b = await asUser('POST', '/api/bookings', { tourId, tourDateId: dateId, guests: 2 });
    assert.equal(b.status, 201);
    const pay = await asUser('POST', '/api/payments/zarinpal/request', { bookingId: b.data.booking.id });
    assert.equal(pay.status, 200);
    assert.match(pay.data.redirectUrl, /\/pg\/StartPay\/A0+/);
    assert.equal(gateway.length, 1);
    const authority = db.getBookingById(b.data.booking.id).zarinpal_authority;
    const cb = await call('GET', `/api/payments/zarinpal/callback?Authority=${authority}&Status=OK`);
    assert.equal(cb.res.headers.get('location'), `${ORIGIN}/booking/result?status=success&ref=${b.data.booking.ref}`);
    assert.equal(db.getBookingById(b.data.booking.id).payment_status, 'paid');
    assert.equal((await asUser('GET', `/api/me/bookings/${b.data.booking.ref}`)).data.onlineBookingOpen, true);
  } finally { setSwitch(undefined); }
});

test('switch on, but the tour is reserved elsewhere or not at all: the site still takes no online booking for it', async () => {
  setSwitch('true');
  try {
    for (const [mode, extra] of [['external', { bookingUrl: 'https://example.org/book' }], ['none', {}]]) {
      assert.equal((await asAdmin('PUT', `/api/admin/tours/${tourId}`, { bookingMode: mode, ...extra })).status, 200);
      const before = count('bookings');
      const gatewayBefore = gateway.length;
      const r = await asUser('POST', '/api/bookings', { tourId, tourDateId: dateId, guests: 1 });
      assert.deepEqual([r.status, r.data.error], [409, 'online_booking_unavailable'], mode);
      assert.equal(count('bookings'), before);
      const p = await asUser('POST', '/api/payments/zarinpal/request', { bookingId: oldBooking.id });
      assert.deepEqual([p.status, p.data.error], [409, 'online_booking_unavailable'], mode);
      assert.equal(gateway.length, gatewayBefore);
      assert.equal((await asUser('GET', `/api/me/bookings/${oldBooking.ref}`)).data.onlineBookingOpen, false, `${mode}: no "try again"`);
      const page = (await call('GET', `/tour/${tourId}`)).text;
      assert.ok(!page.includes('data-booking') && !page.includes('زرین‌پال'), mode);
    }
  } finally {
    setSwitch(undefined);
    await asAdmin('PUT', `/api/admin/tours/${tourId}`, { bookingMode: 'online' });
  }
});
