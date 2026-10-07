import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Fix after the unify-site release: the admin's tour JSON carries the card day/month labels the editor reads back.
const dir = mkdtempSync(join(tmpdir(), 'chaacme-adminfix-'));
const PORT = 6950 + Math.floor(Math.random() * 40);
Object.assign(process.env, {
  CHAACME_PLATFORM_DB: join(dir, 't.db'), IP_HASH_SALT: 'x'.repeat(24), OTP_PEPPER: 'y'.repeat(24),
  FRONTEND_STATIC_DIR: join(dir, 'images'), SITE_ORIGIN: 'https://example.test/', PORT: String(PORT), HOST: '127.0.0.1', FRONTEND_ORIGIN: 'https://example.test'
});
const { server } = await import('../server/index.js');
const db = await import('../server/db.js');
const adminAuth = await import('../server/adminAuth.js');
const base = `http://127.0.0.1:${PORT}`;
before(async () => { if (!server.listening) await new Promise((r) => server.once('listening', r)); });
after(() => server.close());

test('the admin tour JSON has dayLabel/monthLabel, so saving the editor does not blank the card date', async () => {
  const sess = adminAuth.adminLogin((adminAuth.upsertAdminUser('root', 'pw-pw-pw-pw'), 'root'), 'pw-pw-pw-pw');
  const call = async (method, path, body) => {
    const res = await fetch(base + path, { method, headers: { origin: 'https://example.test', cookie: `chaacme_admin_session=${sess}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  db.createTour({ id: 'dated', status: 'published', name: 'تاریخ‌دار', price: 1, dayLabel: '۱۲', monthLabel: 'مهر' });
  const t = (await call('GET', '/api/admin/tours/dated')).data.tour;
  assert.deepEqual([t.dayLabel, t.monthLabel], ['۱۲', 'مهر']);
  assert.deepEqual(t.date, { day: '۱۲', month: 'مهر' });
  // what the editor sends back when nothing was touched keeps them
  assert.equal((await call('PUT', '/api/admin/tours/dated', { name: t.name, status: t.status, dayLabel: t.dayLabel, monthLabel: t.monthLabel })).status, 200);
  assert.deepEqual((await call('GET', '/api/admin/tours/dated')).data.tour.date, { day: '۱۲', month: 'مهر' });
  // a tour without labels reads back null (the editor shows an empty field)
  db.createTour({ id: 'undated', status: 'published', name: 'بی‌تاریخ', price: 1 });
  const u = (await call('GET', '/api/admin/tours/undated')).data.tour;
  assert.deepEqual([u.dayLabel, u.monthLabel], [null, null]);
  // and the public tour JSON does not gain the raw fields
  const pub = await (await fetch(`${base}/api/tours/dated`)).json();
  assert.ok(!('dayLabel' in (pub.tour || pub)) && !('monthLabel' in (pub.tour || pub)));
});
