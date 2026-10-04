// Ordered, run-once schema migrations.
//
// db.js still bootstraps the original schema with idempotent
// CREATE TABLE IF NOT EXISTS / ensureColumn() (that history is the baseline and
// is left alone). Every schema change from here on is a numbered migration in
// ./migrations, recorded in schema_migrations so it runs exactly once per
// database. A migration that throws is rolled back and aborts boot, rather than
// leaving a half-migrated database serving traffic.

export function runMigrations(db, migrations) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  const ids = migrations.map((m) => m.id);
  if (new Set(ids).size !== ids.length || ids.some((id, i) => i > 0 && id <= ids[i - 1])) {
    throw new Error('migrations must have unique, strictly increasing ids');
  }

  const applied = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((r) => r.id));
  const ran = [];
  for (const m of migrations) {
    if (applied.has(m.id)) continue;
    db.exec('BEGIN');
    try {
      m.up(db);
      db.prepare('INSERT INTO schema_migrations (id, name) VALUES (?, ?)').run(m.id, m.name);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      err.message = `migration ${m.id} (${m.name}) failed: ${err.message}`;
      throw err;
    }
    ran.push(m.id);
  }
  return ran;
}

export function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}
