import { hasColumn } from '../migrate.js';

// Content for the unified site. Additive only; existing rows are untouched and every
// block that depends on a new value stays hidden until an admin fills it in.
//
//   site_settings        key/value text edited in the admin («صفحهٔ اول و تنظیمات»): home hero, explainer,
//                        become-host band, footer links, Instagram handle, the four info-page bodies.
//                        Values are plain text (or a JSON list for footer links); keys are whitelisted in
//                        server/settings.js, so a row for an unknown key is never read.
//   host_media.alt       alt text of a gallery image (the caption column already exists)
//   hosts.region_key     desert | forest | sea: the colour of a place's region stamp. Validated in the app
//                        against deploy/assets/js/shared/regions.js (no CHECK, so adding a region needs no migration).
//                        Set by the admin only.
export default {
  id: 4,
  name: 'site_content',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS site_settings (
        key        TEXT PRIMARY KEY,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    if (!hasColumn(db, 'host_media', 'alt')) db.exec('ALTER TABLE host_media ADD COLUMN alt TEXT');
    if (!hasColumn(db, 'hosts', 'region_key')) db.exec('ALTER TABLE hosts ADD COLUMN region_key TEXT');
  }
};
