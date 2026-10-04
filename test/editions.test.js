import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.CHAACME_PLATFORM_DB = join(mkdtempSync(join(tmpdir(), 'chaacme-')), 't.db');
process.env.IP_HASH_SALT = 'x'.repeat(24);
process.env.OTP_PEPPER = 'y'.repeat(24);

const db = await import('../server/db.js');
const { validateEditionDates } = await import('../server/util.js');

let tourId, userId;
before(() => {
  db.seed();
  tourId = db.listTours().find((t) => !t.comingSoon).id;
  userId = Number(db.db.prepare(
    "INSERT INTO users (phone, first_name, last_name, username) VALUES ('09120000000','a','b','ab_test')"
  ).run().lastInsertRowid);
});

const shift = (days) => {
  const d = new Date(Date.now() + days * 864e5);
  return db.todayIso(d);
};

test('validateEditionDates: format, null clearing, ordering', () => {
  assert.deepEqual(validateEditionDates({ startsOn: '2026-10-12' }).value, { startsOn: '2026-10-12' });
  assert.equal(validateEditionDates({ startsOn: '2026-02-30' }).ok, false);
  assert.equal(validateEditionDates({ startsOn: '12-10-2026' }).ok, false);
  assert.deepEqual(validateEditionDates({ startsOn: null }).value, { startsOn: null });
  assert.equal(validateEditionDates({ endsOn: '2026-10-12' }).ok, false);
  assert.equal(validateEditionDates({ startsOn: '2026-10-12', endsOn: '2026-10-11' }).ok, false);
  assert.equal(validateEditionDates({ endsOn: '2026-10-11' }, { startsOn: '2026-10-12' }).ok, false);
  assert.equal(validateEditionDates({ endsOn: '2026-10-14' }, { startsOn: '2026-10-12' }).ok, true);
});

test('past edition is shown as finished and cannot be booked', () => {
  const past = db.addTourDate(tourId, { label: 'گذشته', capacity: 10, startsOn: shift(-10), endsOn: shift(-9) });
  const future = db.addTourDate(tourId, { label: 'آینده', capacity: 10, startsOn: shift(20) });
  const dates = db.getTourDetail(tourId).bookingDates;
  const p = dates.find((d) => d.id === past.id);
  const f = dates.find((d) => d.id === future.id);
  assert.equal(p.disabled, true);
  assert.equal(p.status, 'برگزار شد');
  assert.equal(f.disabled, false);
  assert.throws(() => db.createBooking({ userId, tourId, tourDateId: past.id, guests: 1 }), { code: 'date_in_past' });
  assert.ok(db.createBooking({ userId, tourId, tourDateId: future.id, guests: 1 }).ref);
});

test('an edition ending today is still bookable/not past', () => {
  const today = db.addTourDate(tourId, { label: 'امروز', capacity: 5, startsOn: shift(-1), endsOn: shift(0) });
  const row = db.getTourDetail(tourId).bookingDates.find((d) => d.id === today.id);
  assert.equal(row.disabled, false);
});

test('editions without an ISO date behave exactly as before', () => {
  const legacy = db.addTourDate(tourId, { label: 'قدیمی', capacity: 5 });
  const row = db.getTourDetail(tourId).bookingDates.find((d) => d.id === legacy.id);
  assert.equal(row.startsOn, null);
  assert.equal(row.disabled, false);
  assert.ok(db.createBooking({ userId, tourId, tourDateId: legacy.id, guests: 1 }).ref);
});

test('dated editions sort chronologically, undated last', () => {
  const order = db.getTourDetail(tourId).bookingDates.map((d) => d.startsOn);
  const dated = order.filter(Boolean);
  assert.deepEqual(dated, [...dated].sort());
  assert.equal(order.indexOf(null) > order.lastIndexOf(dated.at(-1)), true);
});

test('updateTourDate can set and clear dates', () => {
  const d = db.addTourDate(tourId, { label: 'x', capacity: 1 });
  assert.equal(db.updateTourDate(d.id, { startsOn: '2027-01-02' }).starts_on, '2027-01-02');
  assert.equal(db.updateTourDate(d.id, { startsOn: null, endsOn: null }).starts_on, null);
});

test('user bookings: upcoming follows the ISO date when present', () => {
  const past = db.addTourDate(tourId, { label: 'p2', capacity: 5, startsOn: shift(5) });
  const b = db.createBooking({ userId, tourId, tourDateId: past.id, guests: 1 });
  db.updateTourDate(past.id, { startsOn: shift(-3) }); // edition has now happened
  const mine = db.getUserBookings(userId).find((x) => x.ref === b.ref);
  assert.equal(mine.upcoming, false);
});
