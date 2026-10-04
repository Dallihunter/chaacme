import { hasColumn } from '../migrate.js';

// Partner panel: richer profile fields, owner edits that wait for review, and
// experience proposals.
//
// seeking_place_types / accepts_experience_types are matching inputs for a
// later "partners propose pairings" step. They are stored as JSON arrays of
// short strings and are NEVER part of a public response.
export default {
  id: 2,
  name: 'partner_panel',
  up(db) {
    const add = (table, column, ddl) => {
      if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    };
    add('hosts', 'credentials', 'credentials TEXT');
    add('hosts', 'seeking_place_types', 'seeking_place_types TEXT');
    add('hosts', 'capacity_guests', 'capacity_guests INTEGER');
    add('hosts', 'house_rules', 'house_rules TEXT');
    add('hosts', 'accepts_experience_types', 'accepts_experience_types TEXT');
    // Approximate guest capacity typed on the /become-host form (places).
    add('host_applications', 'capacity_guests', 'capacity_guests INTEGER');

    // An owner's edit never touches `hosts`; it lands here and an admin
    // applies it. payload is the whitelisted, validated proposal only.
    db.exec(`
      CREATE TABLE IF NOT EXISTS host_revisions (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        host_id     INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
        user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
        payload     TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
        admin_note  TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        reviewed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_host_revisions_host ON host_revisions(host_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_host_revisions_status ON host_revisions(status, created_at DESC);
      -- At most one pending revision per profile, enforced by the database.
      CREATE UNIQUE INDEX IF NOT EXISTS uq_host_revisions_pending ON host_revisions(host_id) WHERE status = 'pending';

      -- A partner's idea for an experience, addressed to chaacme. Room for a
      -- counterpart host id later is deliberately NOT added yet.
      CREATE TABLE IF NOT EXISTS experience_proposals (
        id                    INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id               INTEGER REFERENCES users(id) ON DELETE SET NULL,
        host_id               INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
        title                 TEXT NOT NULL,
        description           TEXT NOT NULL,
        preferred_months      TEXT,
        wanted_counterpart_kind TEXT NOT NULL DEFAULT 'none' CHECK (wanted_counterpart_kind IN ('person','place','none')),
        status                TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_discussion','accepted','declined')),
        admin_note            TEXT,
        created_at            TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at            TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_proposals_user ON experience_proposals(user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_proposals_status ON experience_proposals(status, created_at DESC);
    `);
  }
};
