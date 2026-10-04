import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = mkdtempSync(join(tmpdir(), 'chaacme-'));
const PORT = 3900 + Math.floor(Math.random() * 400);
const IMAGES = join(dir, 'images');
const PENDING = join(dir, 'pending-uploads'); // default: beside the DB, outside the web root
Object.assign(process.env, {
  CHAACME_PLATFORM_DB: join(dir, 't.db'), IP_HASH_SALT: 'x'.repeat(24), OTP_PEPPER: 'y'.repeat(24),
  FRONTEND_STATIC_DIR: IMAGES, PORT: String(PORT), HOST: '127.0.0.1',
  FRONTEND_ORIGIN: 'https://chaacme.test' // production-like: the write guard runs in allowlist mode
});
const ORIGIN = 'https://chaacme.test'; // what a browser on the real site sends

const { server } = await import('../server/index.js');
const db = await import('../server/db.js');
const auth = await import('../server/auth.js');
const adminAuth = await import('../server/adminAuth.js');
const base = `http://127.0.0.1:${PORT}`;

before(async () => { if (!server.listening) await new Promise((r) => server.once('listening', r)); });
after(() => server.close());

const mkUser = (n) => {
  const id = Number(db.db.prepare(
    "INSERT INTO users (phone, first_name, last_name, username) VALUES (?, 'n', 'm', ?)"
  ).run(`0912000000${n}`, `user_${n}`).lastInsertRowid);
  return { id, token: auth.createSession(id) };
};
async function call(method, path, { token, admin, body, raw, headers = {} } = {}) {
  const h = { origin: ORIGIN, ...headers };
  if (token) h.cookie = `chaacme_session=${token}`;
  if (admin) h.cookie = `chaacme_admin_session=${admin}`;
  let payload = raw;
  if (body !== undefined) { h['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(base + path, { method, headers: h, body: payload });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, data, text };
}
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
function multipart(buf, filename = 'a.png') {
  const b = '----t' + Math.random().toString(16).slice(2);
  const head = Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`);
  return { raw: Buffer.concat([head, buf, Buffer.from(`\r\n--${b}--\r\n`)]), headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}

let A, B, admin, person, place, tourId;
before(() => {
  db.seed();
  A = mkUser(1); B = mkUser(2);
  adminAuth.upsertAdminUser('root', 'pw-pw-pw-pw');
  admin = adminAuth.adminLogin('root', 'pw-pw-pw-pw');
  person = db.createHost({ slug: 'coach-a', kind: 'person', displayName: 'Coach A', bio: 'b', expertise: 'x',
    photoPath: null, instagramHandle: null, contactPhone: '09120000001', userId: A.id, status: 'active',
    credentials: 'SECRET-CRED', seekingPlaceTypes: ['SECRET-SEEK'] });
  place = db.createHost({ slug: 'lodge-a', kind: 'place', displayName: 'Lodge A', region: 'گیلان', lodgingType: 'بوم‌گردی',
    amenities: ['x'], latitude: 36.123456, longitude: 52.654321, contactPhone: '09120000001', userId: A.id,
    status: 'active', capacityGuests: 20, houseRules: 'SECRET-RULES', acceptsExperienceTypes: ['SECRET-ACCEPT'],
    photoPath: null, bio: null, expertise: null, instagramHandle: null });
  tourId = db.listTours().find((t) => !t.comingSoon).id;
  db.setTourHosts(tourId, [{ hostId: person.id, role: 'lead' }, { hostId: place.id, role: 'venue' }]);
});

const personEdit = (over = {}) => ({ displayName: 'Coach A2', bio: 'new bio', expertise: 'Flow', credentials: 'cert',
  instagramHandle: 'coach_a', seekingPlaceTypes: ['اقامتگاه جنگلی'], ...over });

test('/api/partner/* needs a login', async () => {
  for (const [m, p] of [['GET', '/api/partner/profiles'], ['GET', '/api/partner/profiles/coach-a'],
    ['PUT', '/api/partner/profiles/coach-a/revision'], ['DELETE', '/api/partner/profiles/coach-a/revision'],
    ['POST', '/api/partner/profiles/coach-a/upload'], ['GET', '/api/partner/profiles/coach-a/experiences'],
    ['GET', '/api/partner/proposals'], ['POST', '/api/partner/proposals']]) {
    // An upload route takes multipart (a JSON body there is 415 before auth is even looked at).
    const opts = p.endsWith('/upload') ? multipart(PNG) : { body: m === 'GET' ? undefined : {} };
    assert.equal((await call(m, p, opts)).status, 401, `${m} ${p}`);
  }
});

test('revision flow: submit -> pending, hosts unchanged -> approve applies; one pending per host', async () => {
  const r1 = await call('PUT', '/api/partner/profiles/coach-a/revision', { token: A.token, body: personEdit() });
  assert.equal(r1.status, 201);
  assert.equal(db.getHostAdmin(person.id).displayName, 'Coach A', 'hosts untouched by submit');
  const r2 = await call('PUT', '/api/partner/profiles/coach-a/revision', { token: A.token, body: personEdit({ displayName: 'Coach A3' }) });
  assert.equal(r2.status, 201);
  const n = db.db.prepare("SELECT COUNT(*) AS n FROM host_revisions WHERE host_id = ? AND status = 'pending'").get(person.id).n;
  assert.equal(n, 1, 'new submit replaces the pending one');
  const view = await call('GET', '/api/partner/profiles/coach-a', { token: A.token });
  assert.equal(view.data.pendingRevision.payload.displayName, 'Coach A3');
  assert.equal(view.data.profile.displayName, 'Coach A', 'published stays published');

  const q = await call('GET', '/api/admin/host-revisions?status=pending', { admin });
  assert.equal(q.data.revisions.length, 1);
  assert.equal(q.data.revisions[0].current.displayName, 'Coach A');
  const ok = await call('POST', `/api/admin/host-revisions/${q.data.revisions[0].id}/approve`, { admin, body: {} });
  assert.equal(ok.status, 200);
  const h = db.getHostAdmin(person.id);
  assert.equal(h.displayName, 'Coach A3');
  assert.equal(h.credentials, 'cert');
  assert.deepEqual(h.seekingPlaceTypes, ['اقامتگاه جنگلی']);
  assert.equal(h.status, 'active', 'status is not owner-editable');
  assert.equal((await call('POST', `/api/admin/host-revisions/${q.data.revisions[0].id}/approve`, { admin, body: {} })).status, 404);
});

test('reject leaves the host unchanged and records the note; owner can withdraw', async () => {
  await call('PUT', '/api/partner/profiles/coach-a/revision', { token: A.token, body: personEdit({ displayName: 'Nope' }) });
  const id = db.listRevisionsAdmin('pending')[0].id;
  assert.equal((await call('POST', `/api/admin/host-revisions/${id}/reject`, { admin, body: { adminNote: 'نه' } })).status, 200);
  assert.equal(db.getHostAdmin(person.id).displayName, 'Coach A3');
  const view = await call('GET', '/api/partner/profiles/coach-a', { token: A.token });
  assert.equal(view.data.pendingRevision, null);
  assert.equal(view.data.lastReview.adminNote, 'نه');
  await call('PUT', '/api/partner/profiles/coach-a/revision', { token: A.token, body: personEdit() });
  assert.equal((await call('DELETE', '/api/partner/profiles/coach-a/revision', { token: A.token })).status, 200);
  assert.equal((await call('DELETE', '/api/partner/profiles/coach-a/revision', { token: A.token })).status, 404);
});

test('revision validation: caps, kinds, non-whitelisted keys ignored', async () => {
  const bad = async (over) => (await call('PUT', '/api/partner/profiles/coach-a/revision', { token: A.token, body: personEdit(over) })).status;
  assert.equal(await bad({ credentials: 'x'.repeat(601) }), 422);
  assert.equal(await bad({ seekingPlaceTypes: new Array(11).fill('a') }), 422);
  assert.equal(await bad({ seekingPlaceTypes: 'nope' }), 422);
  assert.equal(await bad({ displayName: '' }), 422);
  assert.equal(await bad({ photoPath: 'https://evil.example/x.png' }), 422);
  assert.equal(await bad({ photoPath: '/images/other-host/x.png' }), 422, 'path not already ours');
  const res = await call('PUT', '/api/partner/profiles/coach-a/revision', { token: A.token,
    body: personEdit({ status: 'hidden', slug: 'hijack', userId: B.id, contactPhone: '09999999999', verified: true, region: 'zzz' }) });
  assert.equal(res.status, 201);
  const p = res.data.revision.payload;
  for (const k of ['status', 'slug', 'userId', 'contactPhone', 'verified', 'region']) assert.equal(k in p, false, k);
  await call('DELETE', '/api/partner/profiles/coach-a/revision', { token: A.token });
  const pl = (over) => call('PUT', '/api/partner/profiles/lodge-a/revision', { token: A.token,
    body: { displayName: 'L', region: 'r', capacityGuests: 20, ...over } });
  assert.equal((await pl({ capacityGuests: 501 })).status, 422);
  assert.equal((await pl({ capacityGuests: 0 })).status, 422);
  assert.equal((await pl({ houseRules: 'x'.repeat(1001) })).status, 422);
  assert.equal((await pl({ latitude: 36.1 })).status, 422, 'half a pin');
  assert.equal((await pl({ latitude: 0, longitude: 0 })).status, 422);
  assert.equal((await pl({ acceptsExperienceTypes: new Array(11).fill('a') })).status, 422);
  await call('DELETE', '/api/partner/profiles/lodge-a/revision', { token: A.token });
});

test('IDOR: user B cannot touch user A profiles, revisions, uploads or experiences', async () => {
  await call('PUT', '/api/partner/profiles/coach-a/revision', { token: A.token, body: personEdit() });
  for (const [m, p, body] of [
    ['GET', '/api/partner/profiles/coach-a'], ['GET', '/api/partner/profiles/lodge-a'],
    ['PUT', '/api/partner/profiles/coach-a/revision', personEdit({ displayName: 'pwn' })],
    ['DELETE', '/api/partner/profiles/coach-a/revision'],
    ['GET', '/api/partner/profiles/coach-a/experiences'],
    ['GET', '/api/partner/profiles/nonexistent']
  ]) {
    const r = await call(m, p, { token: B.token, body });
    assert.equal(r.status, 404, `${m} ${p}`);
  }
  const up = multipart(PNG);
  assert.equal((await call('POST', '/api/partner/profiles/coach-a/upload', { token: B.token, ...up })).status, 404);
  assert.equal(db.listRevisionsAdmin('pending').find((r) => r.host.slug === 'coach-a').payload.displayName, 'Coach A2', 'A revision intact');
  assert.equal((await call('GET', '/api/partner/profiles', { token: B.token })).data.profiles.length, 0);
  // proposals: cannot post as A's profile, cannot read A's list
  const prop = { profileSlug: 'coach-a', title: 'عنوان', description: 'یک توضیح به اندازه کافی بلند' };
  assert.equal((await call('POST', '/api/partner/proposals', { token: B.token, body: prop })).status, 404);
  assert.equal((await call('POST', '/api/partner/proposals', { token: A.token, body: prop })).status, 201);
  assert.equal((await call('GET', '/api/partner/proposals', { token: B.token })).data.proposals.length, 0);
  assert.equal((await call('GET', '/api/partner/proposals', { token: A.token })).data.proposals.length, 1);
  // a body user id is never honoured
  const own = await call('POST', '/api/partner/proposals', { token: B.token, body: { ...prop, userId: A.id, hostId: person.id } });
  assert.equal(own.status, 404);
  await call('DELETE', '/api/partner/profiles/coach-a/revision', { token: A.token });
});

test('uploads: pending folder, not public, traversal rejected, approval moves files', async () => {
  const up = await call('POST', '/api/partner/profiles/lodge-a/upload', { token: A.token, ...multipart(PNG) });
  assert.equal(up.status, 201);
  assert.match(up.data.path, /^\/images\/host-lodge-a\/pending\/[\w.-]+\.png$/);
  assert.equal((await call('POST', '/api/partner/profiles/lodge-a/upload', { token: A.token, ...multipart(Buffer.from('not an image at all')) })).status, 422);
  const pendingPath = up.data.path;
  const pendingName = pendingPath.split('/').pop();
  assert.equal(existsSync(join(PENDING, 'host-lodge-a', pendingName)), true, 'stored under the pending dir');
  assert.equal(existsSync(join(IMAGES, 'host-lodge-a', 'pending')), false, 'nothing is written under the web root');
  const edit = (media, over = {}) => ({ displayName: 'Lodge A', region: 'گیلان', lodgingType: 'x', capacityGuests: 20,
    latitude: 36.234567, longitude: 52.765432, media, ...over });
  for (const evil of ['/images/host-lodge-a/pending/../../x.png', '/images/host-lodge-a/pending/..', '/images/host-coach-a/pending/x.png',
    'https://evil.example/a.png', '/images/host-lodge-a/pending/a/b.png']) {
    const r = await call('PUT', '/api/partner/profiles/lodge-a/revision', { token: A.token, body: edit([{ photoPath: evil }]) });
    assert.equal(r.status, 422, evil);
  }
  // an upload another profile made cannot be borrowed
  const upB = await call('POST', '/api/partner/profiles/coach-a/upload', { token: A.token, ...multipart(PNG) });
  assert.equal((await call('PUT', '/api/partner/profiles/lodge-a/revision', { token: A.token, body: edit([{ photoPath: upB.data.path }]) })).status, 422);
  // nonexistent pending file
  assert.equal((await call('PUT', '/api/partner/profiles/lodge-a/revision', { token: A.token,
    body: edit([{ photoPath: '/images/host-lodge-a/pending/ghost.png' }]) })).status, 422);

  const r = await call('PUT', '/api/partner/profiles/lodge-a/revision', { token: A.token, body: edit([{ photoPath: pendingPath, caption: 'اتاق' }]) });
  assert.equal(r.status, 201);
  const pub = await call('GET', '/api/hosts/lodge-a');
  assert.equal(pub.text.includes('pending'), false, 'pending upload not public');
  assert.equal(pub.data.host.gallery.length, 0);

  const id = db.listRevisionsAdmin('pending').find((x) => x.host.slug === 'lodge-a').id;
  assert.equal((await call('POST', `/api/admin/host-revisions/${id}/approve`, { admin, body: {} })).status, 200);
  const gal = (await call('GET', '/api/hosts/lodge-a')).data.host.gallery;
  assert.equal(gal.length, 1);
  assert.match(gal[0].photoPath, /^\/images\/host-lodge-a\/[\w.-]+\.png$/);
  assert.equal(existsSync(join(IMAGES, gal[0].photoPath.replace('/images/', ''))), true, 'moved to live folder');
  assert.deepEqual(readdirSync(join(PENDING, 'host-lodge-a')).filter((f) => pendingPath.endsWith(f)), [], 'gone from pending after approval');
  assert.equal(db.getHostAdmin(place.id).capacityGuests, 20);
});

test('pending previews: only the owner and an admin can read them', async () => {
  const up = await call('POST', '/api/partner/profiles/lodge-a/upload', { token: A.token, ...multipart(PNG) });
  assert.equal(up.status, 201);
  const name = up.data.path.split('/').pop();
  const ownerUrl = `/api/partner/profiles/lodge-a/pending/${name}`;
  const adminUrl = `/api/admin/host-pending/lodge-a/${name}`;
  const get = (path, cookie) => fetch(base + path, { headers: cookie ? { cookie } : {} });

  assert.equal((await get(ownerUrl)).status, 401, 'anonymous');
  assert.equal((await get(ownerUrl, `chaacme_session=${B.token}`)).status, 404, 'another user cannot even tell it exists');
  assert.equal((await get(adminUrl)).status, 401, 'anonymous on the admin route');
  assert.equal((await get(adminUrl, `chaacme_session=${A.token}`)).status, 401, 'a user session is not an admin session');

  for (const [url, cookie] of [[ownerUrl, `chaacme_session=${A.token}`], [adminUrl, `chaacme_admin_session=${admin}`]]) {
    const r = await get(url, cookie);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('content-type'), 'image/png');
    assert.match(r.headers.get('cache-control'), /private/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), PNG, 'bytes are served intact');
  }
  // a file that is not there, a name that is not a plain filename, and another profile's folder
  assert.equal((await get('/api/partner/profiles/lodge-a/pending/ghost.png', `chaacme_session=${A.token}`)).status, 404);
  assert.equal((await get('/api/partner/profiles/lodge-a/pending/..%2F..%2Ft.db', `chaacme_session=${A.token}`)).status, 404);
  assert.equal((await get(`/api/partner/profiles/coach-a/pending/${name}`, `chaacme_session=${A.token}`)).status, 404, 'right owner, wrong profile folder');
  assert.equal((await get('/api/admin/host-pending/lodge-a/..%2F..%2Ft.db', `chaacme_admin_session=${admin}`)).status, 404);
  // the logical path is not a public URL either: the node service does not serve /images at all
  assert.equal((await get(up.data.path)).status, 404);
  // a text file dropped in the folder is never served as an image
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(PENDING, 'host-lodge-a', 'note.txt'), 'hello');
  assert.equal((await get('/api/partner/profiles/lodge-a/pending/note.txt', `chaacme_session=${A.token}`)).status, 404);
  await call('DELETE', '/api/partner/profiles/lodge-a/revision', { token: A.token });
});

test('PENDING_UPLOAD_DIR inside the web root is refused at startup', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, ['-e', "import('./server/upload.js')"], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, FRONTEND_STATIC_DIR: IMAGES, PENDING_UPLOAD_DIR: join(IMAGES, 'host-x', 'pending') },
    encoding: 'utf8'
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /must be outside FRONTEND_STATIC_DIR/);
});

test('rejecting a revision deletes its pending uploads', async () => {
  const up = await call('POST', '/api/partner/profiles/lodge-a/upload', { token: A.token, ...multipart(PNG) });
  const file = join(PENDING, 'host-lodge-a', up.data.path.split('/').pop());
  assert.equal(existsSync(file), true);
  await call('PUT', '/api/partner/profiles/lodge-a/revision', { token: A.token,
    body: { displayName: 'L', region: 'r', media: [{ photoPath: up.data.path }] } });
  const id = db.listRevisionsAdmin('pending').find((x) => x.host.slug === 'lodge-a').id;
  await call('POST', `/api/admin/host-revisions/${id}/reject`, { admin, body: {} });
  assert.equal(existsSync(file), false);
});

test('public responses never carry admin-only or private fields (deep scan)', async () => {
  const urls = ['/api/hosts/coach-a', '/api/hosts/lodge-a', `/api/tours/${tourId}`, '/api/tours'];
  for (const u of urls) {
    const r = await call('GET', u);
    assert.equal(r.status, 200, u);
    const t = r.text;
    for (const needle of ['SECRET-', 'seekingPlaceTypes', 'acceptsExperienceTypes', 'seeking_place', 'accepts_experience',
      'credentials', 'houseRules', 'capacityGuests', 'contactPhone', 'contact_phone', 'userId', 'user_id', '09120000001',
      '36.123456', '52.654321', '36.234567', '52.765432']) {
      assert.equal(t.includes(needle), false, `${u} leaked ${needle}`);
    }
  }
  // the owner (and only the owner) does see their own
  const own = await call('GET', '/api/partner/profiles/lodge-a', { token: A.token });
  assert.equal(own.data.profile.contactPhone, '09120000001');
  assert.equal(own.data.profile.latitude, 36.234567);
  assert.ok(Array.isArray(own.data.profile.acceptsExperienceTypes));
  assert.equal(own.data.profile.capacityGuests, 20);
});

test('partner experiences: counts only, no traveler identity', async () => {
  const ed = db.addTourDate(tourId, { label: 'x', capacity: 10, startsOn: db.todayIso(new Date(Date.now() + 5 * 864e5)) });
  db.db.prepare(
    `INSERT INTO bookings (ref, tour_id, tour_date_id, user_id, guests, price_per_person, total, status, payment_status)
     VALUES ('REF1', ?, ?, ?, 2, 1, 2, 'confirmed', 'paid')`
  ).run(tourId, ed.id, B.id);
  const r = await call('GET', '/api/partner/profiles/coach-a/experiences', { token: A.token });
  assert.equal(r.status, 200);
  const e = r.data.experiences.find((x) => x.tourId === tourId).editions.find((x) => x.label === 'x');
  assert.deepEqual([e.bookings, e.guests, e.phase], [1, 2, 'upcoming']);
  assert.equal(r.text.includes('REF1'), false);
  assert.equal(r.text.includes('user_'), false);
  assert.equal(r.data.experiences[0].role, 'lead');
});

test('proposals: validation and rate limit', async () => {
  const C = mkUser(3);
  db.createHost({ slug: 'coach-c', kind: 'person', displayName: 'C', userId: C.id, status: 'hidden', photoPath: null,
    bio: null, expertise: null, instagramHandle: null, contactPhone: null });
  const send = (over) => call('POST', '/api/partner/proposals', { token: C.token,
    body: { profileSlug: 'coach-c', title: 'عنوان خوب', description: 'یک توضیح به اندازه کافی بلند', ...over } });
  assert.equal((await send({ title: 'a' })).status, 422);
  assert.equal((await send({ title: 'x'.repeat(121) })).status, 422);
  assert.equal((await send({ description: 'کوتاه' })).status, 422);
  assert.equal((await send({ description: 'x'.repeat(2001) })).status, 422);
  assert.equal((await send({ preferredMonths: 'x'.repeat(61) })).status, 422);
  assert.equal((await send({ wantedCounterpartKind: 'robot' })).status, 422);
  for (let i = 0; i < 5; i++) assert.equal((await send({ wantedCounterpartKind: 'place' })).status, 201, `n${i}`);
  assert.equal((await send({})).status, 429);
  const adminList = await call('GET', '/api/admin/proposals?status=new', { admin });
  assert.ok(adminList.data.proposals.length >= 5);
  const id = adminList.data.proposals[0].id;
  const upd = await call('PUT', `/api/admin/proposals/${id}`, { admin, body: { status: 'in_discussion', adminNote: 'پیگیری' } });
  assert.equal(upd.data.proposal.status, 'in_discussion');
  const mine = await call('GET', '/api/partner/proposals', { token: C.token });
  assert.equal(mine.text.includes('پیگیری'), false, 'admin note stays internal');
  assert.equal((await call('PUT', `/api/admin/proposals/${id}`, { admin, body: { status: 'bogus' } })).status, 422);
});

test('apply flow: place capacity travels application -> approved host', async () => {
  const D = mkUser(4);
  const r = await call('POST', '/api/host-applications', { token: D.token, body: {
    kind: 'place', fullName: 'اقامتگاه تست', region: 'مازندران', lodgingType: 'کلبه', capacityGuests: 12,
    description: 'جایی بسیار خاص برای گروه‌ها' } });
  assert.equal(r.status, 201);
  assert.equal((await call('POST', '/api/host-applications', { token: D.token, body: {
    kind: 'place', fullName: 'بد', region: 'مازندران', capacityGuests: 9999, description: 'جایی بسیار خاص برای گروه‌ها' } })).status, 422);
  const app = (await call('GET', '/api/admin/host-applications?status=pending', { admin })).data.applications[0];
  assert.equal(app.capacityGuests, 12);
  const ok = await call('POST', `/api/admin/host-applications/${app.id}/approve`, { admin, body: { slug: 'lodge-d' } });
  assert.equal(ok.data.host.capacityGuests, 12);
  assert.equal((await call('GET', '/api/partner/profiles', { token: D.token })).data.profiles[0].slug, 'lodge-d');
});
