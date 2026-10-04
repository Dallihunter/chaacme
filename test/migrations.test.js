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
`);

test('upgrades an old tour_dates table without losing rows, then is a no-op', () => {
  const db = new DatabaseSync(':memory:');
  oldSchema(db);
  assert.deepEqual(runMigrations(db, migrations), [1]);
  assert.ok(hasColumn(db, 'tour_dates', 'starts_on'));
  assert.ok(hasColumn(db, 'tour_dates', 'ends_on'));
  const row = db.prepare('SELECT * FROM tour_dates').get();
  assert.equal(row.label, '۱۲ مهر');
  assert.equal(row.seats_taken, 9);
  assert.equal(row.starts_on, null); // no guessed years
  assert.deepEqual(runMigrations(db, migrations), []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get().n, 1);
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
