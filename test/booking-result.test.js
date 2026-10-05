import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'chaacme-br-'));
const PORT = 6000 + Math.floor(Math.random() * 300);
Object.assign(process.env, {
  CHAACME_PLATFORM_DB: join(dir, 't.db'), IP_HASH_SALT: 'x'.repeat(24), OTP_PEPPER: 'y'.repeat(24), FRONTEND_STATIC_DIR: join(dir, 'images'),
  PORT: String(PORT), HOST: '127.0.0.1', FRONTEND_ORIGIN: 'https://example.test'
});
const { server } = await import('../server/index.js');
const db = await import('../server/db.js');
const auth = await import('../server/auth.js');
const base = `http://127.0.0.1:${PORT}`;
before(async () => { if (!server.listening) await new Promise((r) => server.once('listening', r)); });
after(() => server.close());

const user = (n) => { const id = Number(db.db.prepare("INSERT INTO users (phone, first_name, last_name, username) VALUES (?, 'n', 'm', ?)").run(`0912000050${n}`, `br_${n}`).lastInsertRowid); return { id, token: auth.createSession(id) }; };
const get = async (path, token) => { const r = await fetch(base + path, { headers: token ? { cookie: `chaacme_session=${token}` } : {} }); return { status: r.status, text: await r.text() }; };

test('GET /api/me/bookings/<ref>: owner only, one uniform not-found, no gateway identifiers', async () => {
  db.seed();
  const A = user(1); const B = user(2);
  const mk = (u, tourId, guests) => {
    db.createTour({ id: tourId, status: 'published', name: `تور ${tourId}`, price: 1000000 });
    const d = db.addTourDate(tourId, { label: 'اجرا', capacity: 10, startsOn: db.todayIso(new Date(Date.now() + 9 * 864e5)) });
    return db.createBooking({ userId: u.id, tourId, tourDateId: d.id, guests });
  };
  const a1 = mk(A, 'br-one', 2); const a2 = mk(A, 'br-two', 3); const b1 = mk(B, 'br-three', 1);
  db.setBookingAuthority(a1.id, 'AUTHORITY-SECRET');
  db.confirmBookingPayment(a1.id, { refId: 'REFID-SECRET' });

  const own = await get(`/api/me/bookings/${a1.ref}`, A.token);
  assert.equal(own.status, 200);
  const b = JSON.parse(own.text).booking;
  assert.deepEqual([b.tourTitle, b.tourSlug, b.guests, b.total, b.paymentStatus, b.status], ['تور br-one', 'br-one', 2, 2000000, 'paid', 'confirmed']);
  assert.ok(!/AUTHORITY|REFID|zarinpal|user_?id|phone/i.test(own.text), 'no gateway ids, no user data');
  const two = JSON.parse((await get(`/api/me/bookings/${a2.ref}`, A.token)).text).booking;
  assert.deepEqual([two.tourTitle, two.total, two.paymentStatus], ['تور br-two', 3000000, 'pending']);

  const notFound = JSON.stringify({ error: 'not_found' });
  for (const ref of [b1.ref, 'CHK-00000', 'CHK-1', 'nonsense', '%E0%A4%A', encodeURIComponent("CHK-12345' OR 1=1"), 'chk-12345']) {
    const r = await get(`/api/me/bookings/${ref}`, A.token);
    assert.equal(r.status, 404, ref);
    assert.equal(r.text, notFound, `${ref}: someone else's ref looks exactly like an unknown one`);
  }
  assert.equal((await get(`/api/me/bookings/${a1.ref}`)).status, 401, 'logged out');
  assert.equal((await get(`/api/me/bookings/${a1.ref}`, B.token)).status, 404, 'the other user');
  assert.equal((await fetch(`${base}/api/me/bookings/${a1.ref}`, { method: 'POST', headers: { cookie: `chaacme_session=${A.token}`, origin: 'https://example.test' } })).status, 404);
});

test('GET /api/bookings/me now carries the payment status and the tour cover (additive)', async () => {
  const A = db.db.prepare("SELECT id FROM users WHERE username = 'br_1'").get().id;
  const token = auth.createSession(A);
  const list = JSON.parse((await get('/api/bookings/me', token)).text).bookings;
  assert.ok(list.length === 2 && list.every((x) => 'paymentStatus' in x && 'coverPath' in x && 'ref' in x && 'upcoming' in x));
  assert.deepEqual(list.map((x) => x.paymentStatus).sort(), ['paid', 'pending']);
});
