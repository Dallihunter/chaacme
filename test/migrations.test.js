import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { runMigrations, hasColumn } from '../server/migrate.js';
import migrations from '../server/migrations/index.js';

const oldSchema = (db) => db.exec(`
  CREATE TABLE tour_dates (
    id INTEGER PRIMARY KEY AUTOINCREMENT, tour_id TEXT NOT NULL, label TEXT NOT NULL,
    capacity INTEGER NOT NULL DEFAULT 0, seats_taken INTEGER NOT NULL DEFAULT 0,
    closed INTEGER NOT NULL DEFAULT 0
  );
  INSERT INTO tour_dates (tour_id, label, capacity, seats_taken) VALUES ('t', '۱۲ مهر', 12, 9);
  CREATE TABLE hosts (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT, user_id INTEGER);
  CREATE TABLE host_applications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER);
  CREATE TABLE host_media (id INTEGER PRIMARY KEY AUTOINCREMENT, host_id INTEGER, path TEXT NOT NULL, caption TEXT, sort_order INTEGER NOT NULL DEFAULT 0);
  INSERT INTO host_media (host_id, path, caption) VALUES (1, '/images/host-keep-me/a.jpg', 'خانه');
  INSERT INTO hosts (slug) VALUES ('keep-me');
  CREATE TABLE tours (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE tour_media (id INTEGER PRIMARY KEY AUTOINCREMENT, tour_id TEXT, ordinal INTEGER, label TEXT, image_path TEXT);
  CREATE TABLE tour_highlights (id INTEGER PRIMARY KEY AUTOINCREMENT, tour_id TEXT, ordinal INTEGER, name TEXT NOT NULL, description TEXT);
  CREATE TABLE tour_itinerary (id INTEGER PRIMARY KEY AUTOINCREMENT, tour_id TEXT, ordinal INTEGER, title TEXT NOT NULL);
  INSERT INTO tours (id, name) VALUES ('old-tour', 'قدیمی');
  INSERT INTO tour_media (tour_id, ordinal, label, image_path) VALUES ('old-tour', 0, 'x', '/images/a.jpg');
  INSERT INTO tour_highlights (tour_id, ordinal, name) VALUES ('old-tour', 0, 'h');
  INSERT INTO tour_itinerary (tour_id, ordinal, title) VALUES ('old-tour', 0, 't');
`);

test('upgrades an old tour_dates table without losing rows, then is a no-op', () => {
  const db = new DatabaseSync(':memory:');
  oldSchema(db);
  assert.deepEqual(runMigrations(db, migrations), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(hasColumn(db, 'tour_dates', 'starts_on'));
  assert.ok(hasColumn(db, 'tour_dates', 'ends_on'));
  const row = db.prepare('SELECT * FROM tour_dates').get();
  assert.equal(row.label, '۱۲ مهر');
  assert.equal(row.seats_taken, 9);
  assert.equal(row.starts_on, null); // no guessed years
  assert.deepEqual(runMigrations(db, migrations), []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 7);
  // partner panel: new columns/tables exist, existing rows untouched
  for (const c of ['credentials', 'seeking_place_types', 'capacity_guests', 'house_rules', 'accepts_experience_types']) {
    assert.ok(hasColumn(db, 'hosts', c), c);
  }
  assert.ok(hasColumn(db, 'host_applications', 'capacity_guests'));
  assert.equal(db.prepare('SELECT slug FROM hosts').get().slug, 'keep-me');
  for (const t of ['host_revisions', 'experience_proposals']) {
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sqlite_master WHERE name = ?').get(t).n, 1, t);
  }
});

test('tour page content migration is additive: new columns exist and are NULL on old rows', () => {
  const db = new DatabaseSync(':memory:');
  oldSchema(db);
  runMigrations(db, migrations);
  for (const c of ['story', 'region', 'experience_type', 'level', 'bring_list', 'seo_description']) assert.ok(hasColumn(db, 'tours', c), c);
  for (const c of ['alt', 'caption']) assert.ok(hasColumn(db, 'tour_media', c), c);
  for (const c of ['image_path', 'image_alt', 'image_caption']) assert.ok(hasColumn(db, 'tour_highlights', c), c);
  assert.ok(hasColumn(db, 'tour_itinerary', 'images'));
  const tour = db.prepare('SELECT * FROM tours').get();
  assert.equal(tour.name, 'قدیمی');
  for (const c of ['story', 'region', 'experience_type', 'level', 'bring_list', 'seo_description']) assert.equal(tour[c], null, c);
  assert.equal(db.prepare('SELECT image_path FROM tour_media').get().image_path, '/images/a.jpg');
  assert.equal(db.prepare('SELECT alt FROM tour_media').get().alt, null);
  assert.equal(db.prepare('SELECT images FROM tour_itinerary').get().images, null);
});

test('a failing migration rolls back and is not recorded', () => {
  const db = new DatabaseSync(':memory:');
  const bad = [{ id: 1, name: 'bad', up(d) { d.exec('CREATE TABLE x (a)'); throw new Error('boom'); } }];
  assert.throws(() => runMigrations(db, bad), /migration 1 \(bad\) failed: boom/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'x'").get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 0);
});

test('rejects non-increasing migration ids', () => {
  const db = new DatabaseSync(':memory:');
  const up = () => {};
  assert.throws(() => runMigrations(db, [{ id: 2, name: 'a', up }, { id: 1, name: 'b', up }]), /strictly increasing/);
});

test('site content migration is additive: new table and columns, old rows untouched', () => {
  const db = new DatabaseSync(':memory:');
  oldSchema(db);
  runMigrations(db, migrations);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'site_settings'").get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM site_settings').get().n, 0, 'nothing is seeded: empty means hidden');
  assert.ok(hasColumn(db, 'host_media', 'alt'));
  assert.ok(hasColumn(db, 'hosts', 'region_key'));
  const m = db.prepare('SELECT * FROM host_media').get();
  assert.deepEqual([m.path, m.caption, m.alt], ['/images/host-keep-me/a.jpg', 'خانه', null]);
  assert.equal(db.prepare('SELECT region_key FROM hosts').get().region_key, null);
});

test('credentials stay private after the migration: the flag is added at 0 for every existing row', () => {
  const db = new DatabaseSync(':memory:');
  oldSchema(db);
  runMigrations(db, migrations.slice(0, 2)); // the schema as it was when owners entered their credentials
  db.exec("UPDATE hosts SET credentials = 'سابقهٔ خصوصی'");
  db.exec("INSERT INTO hosts (slug, credentials) VALUES ('second', 'دومی')");
  assert.deepEqual(runMigrations(db, migrations), [3, 4, 5, 6, 7]);
  assert.ok(hasColumn(db, 'hosts', 'credentials_public'));
  const rows = db.prepare('SELECT credentials, credentials_public AS p FROM hosts ORDER BY id').all();
  assert.deepEqual(rows.map((r) => [r.credentials, r.p]), [['سابقهٔ خصوصی', 0], ['دومی', 0]]);
});

test('migration 007: booking mode, link, label, note and the per-link role label are additive; old rows keep today\'s behaviour', () => {
  const db = new DatabaseSync(':memory:');
  oldSchema(db);
  db.exec(`CREATE TABLE tour_hosts (tour_id TEXT NOT NULL, host_id INTEGER NOT NULL, role TEXT NOT NULL DEFAULT 'lead', sort_order INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tour_id, host_id));
    INSERT INTO tour_hosts (tour_id, host_id, role, sort_order) VALUES ('old-tour', 1, 'lead', 3);`);
  runMigrations(db, migrations.slice(0, 6));
  const before = db.prepare('SELECT * FROM tours').get();
  assert.equal(hasColumn(db, 'tours', 'booking_mode'), false);

  assert.deepEqual(runMigrations(db, migrations), [7]);
  for (const c of ['booking_mode', 'booking_url', 'booking_label', 'booking_note']) assert.ok(hasColumn(db, 'tours', c), c);
  assert.ok(hasColumn(db, 'tour_hosts', 'role_label'));

  const tour = db.prepare('SELECT * FROM tours').get();
  for (const k of Object.keys(before)) assert.equal(tour[k], before[k], `tours.${k} is unchanged`);
  assert.equal(tour.booking_mode, 'online', 'every existing tour keeps the online booking behaviour');
  assert.equal(tour.booking_url, null);
  assert.equal(tour.booking_label, 'رزرو');
  assert.equal(tour.booking_note, null);
  const link = db.prepare('SELECT * FROM tour_hosts').get();
  assert.deepEqual([link.tour_id, link.host_id, link.role, link.sort_order, link.role_label], ['old-tour', 1, 'lead', 3, null]);

  // the database refuses a mode that is not one of the three
  assert.throws(() => db.exec("UPDATE tours SET booking_mode = 'free-for-all'"), /CHECK constraint/);
  db.exec("INSERT INTO tours (id, name) VALUES ('new-tour', 'جدید')");
  assert.equal(db.prepare("SELECT booking_mode FROM tours WHERE id = 'new-tour'").get().booking_mode, 'online');

  // idempotent: a second pass changes nothing, and an insert that names none of the new columns (the previous release's) still works
  assert.deepEqual(runMigrations(db, migrations), []);
  db.exec("INSERT INTO tour_hosts (tour_id, host_id, role) VALUES ('new-tour', 2, 'co_host')");
  assert.equal(db.prepare('SELECT role_label FROM tour_hosts WHERE host_id = 2').get().role_label, null);
});
