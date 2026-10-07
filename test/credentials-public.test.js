import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'chaacme-cred-'));
const PORT = 6400 + Math.floor(Math.random() * 300);
Object.assign(process.env, {
  CHAACME_PLATFORM_DB: join(dir, 't.db'), IP_HASH_SALT: 'x'.repeat(24), OTP_PEPPER: 'y'.repeat(24), FRONTEND_STATIC_DIR: join(dir, 'images'),
  PORT: String(PORT), HOST: '127.0.0.1', FRONTEND_ORIGIN: 'https://example.test'
});
const { server } = await import('../server/index.js');
const db = await import('../server/db.js');
const auth = await import('../server/auth.js');
const adminAuth = await import('../server/adminAuth.js');
const base = `http://127.0.0.1:${PORT}`;
before(async () => { if (!server.listening) await new Promise((r) => server.once('listening', r)); });
after(() => server.close());

async function call(method, path, { token, admin, body } = {}) {
  const h = { origin: 'https://example.test' };
  if (token) h.cookie = `chaacme_session=${token}`;
  if (admin) h.cookie = `chaacme_admin_session=${admin}`;
  let payload;
  if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + path, { method, headers: h, body: payload });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, data, text };
}

test('opt-in goes through the review flow; default stays private; admin can see and set it', async () => {
  db.seed();
  const uid = Number(db.db.prepare("INSERT INTO users (phone, first_name, last_name, username) VALUES ('09120000601','n','m','cred_u')").run().lastInsertRowid);
  const token = auth.createSession(uid);
  adminAuth.upsertAdminUser('root', 'pw-pw-pw-pw');
  const admin = adminAuth.adminLogin('root', 'pw-pw-pw-pw');
  const host = db.createHost({ slug: 'cred-coach', kind: 'person', displayName: 'مربی', expertise: 'x', credentials: 'گواهینامهٔ محرمانه', status: 'active', userId: uid,
    photoPath: null, bio: null, instagramHandle: null, contactPhone: null });
  assert.equal(host.credentialsPublic, false, 'default');
  assert.ok(!(await call('GET', '/host/cred-coach')).text.includes('گواهینامهٔ محرمانه'));

  const edit = (over) => ({ displayName: 'مربی', expertise: 'x', credentials: 'گواهینامهٔ محرمانه', ...over });
  assert.equal((await call('PUT', '/api/partner/profiles/cred-coach/revision', { token, body: edit({ credentialsPublic: 'yes' }) })).status, 422, 'must be a boolean');
  const r = await call('PUT', '/api/partner/profiles/cred-coach/revision', { token, body: edit({ credentialsPublic: true }) });
  assert.equal(r.status, 201, r.text);
  assert.equal(r.data.revision.payload.credentialsPublic, true);
  // pending: the live profile and the public page are untouched
  assert.equal(db.getHostAdmin(host.id).credentialsPublic, false);
  assert.ok(!(await call('GET', '/host/cred-coach')).text.includes('گواهینامهٔ محرمانه'));
  const view = await call('GET', '/api/partner/profiles/cred-coach', { token });
  assert.equal(view.data.profile.credentialsPublic, false);
  assert.equal(view.data.pendingRevision.payload.credentialsPublic, true);

  const pending = db.listRevisionsAdmin('pending').find((x) => x.host.slug === 'cred-coach');
  assert.equal(pending.current.credentialsPublic, false, 'the admin diff has the live value');
  assert.equal((await call('POST', `/api/admin/host-revisions/${pending.id}/approve`, { admin, body: {} })).status, 200);
  assert.equal(db.getHostAdmin(host.id).credentialsPublic, true);
  const page = await call('GET', '/host/cred-coach');
  assert.ok(page.text.includes('گواهینامهٔ محرمانه') && page.text.includes('سوابق و گواهینامه‌ها'));

  // owner turns it off again: same flow
  assert.equal((await call('PUT', '/api/partner/profiles/cred-coach/revision', { token, body: edit({ credentialsPublic: false }) })).status, 201);
  assert.ok((await call('GET', '/host/cred-coach')).text.includes('گواهینامهٔ محرمانه'), 'still public until approved');
  const p2 = db.listRevisionsAdmin('pending').find((x) => x.host.slug === 'cred-coach');
  await call('POST', `/api/admin/host-revisions/${p2.id}/approve`, { admin, body: {} });
  assert.ok(!(await call('GET', '/host/cred-coach')).text.includes('گواهینامهٔ محرمانه'));

  // a revision that does not mention the flag counts as "off" (the form always sends it)
  await call('PUT', '/api/partner/profiles/cred-coach/revision', { token, body: edit({ credentialsPublic: true }) });
  await call('POST', `/api/admin/host-revisions/${db.listRevisionsAdmin('pending')[0].id}/approve`, { admin, body: {} });
  await call('PUT', '/api/partner/profiles/cred-coach/revision', { token, body: edit({}) });
  await call('POST', `/api/admin/host-revisions/${db.listRevisionsAdmin('pending')[0].id}/approve`, { admin, body: {} });
  assert.equal(db.getHostAdmin(host.id).credentialsPublic, false);

  // admin sees and sets it; an admin save that omits it keeps it
  assert.equal((await call('PUT', `/api/admin/hosts/${host.id}`, { admin, body: { displayName: 'مربی', status: 'active', credentials: 'گواهینامهٔ محرمانه', credentialsPublic: true } })).data.host.credentialsPublic, true);
  assert.equal((await call('PUT', `/api/admin/hosts/${host.id}`, { admin, body: { displayName: 'مربی', status: 'active' } })).data.host.credentialsPublic, true);
  assert.equal((await call('PUT', `/api/admin/hosts/${host.id}`, { admin, body: { displayName: 'مربی', status: 'active', credentialsPublic: 'x' } })).status, 422);
  // a place never has credentials, whatever the payload says
  const place = db.createHost({ slug: 'cred-place', kind: 'place', displayName: 'مکان', region: 'r', status: 'active', photoPath: null, bio: null, expertise: null, instagramHandle: null, contactPhone: null });
  const pr = await call('PUT', `/api/admin/hosts/${place.id}`, { admin, body: { displayName: 'مکان', region: 'r', status: 'active', credentials: 'x', credentialsPublic: true } });
  assert.deepEqual([pr.data.host.credentials, pr.data.host.credentialsPublic], [null, false]);
});
