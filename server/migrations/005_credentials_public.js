import { hasColumn } from '../migrate.js';

// Credentials stay private unless the owner (or an admin) switches them on.
//
// The partner form told owners that «سوابق و گواهینامه‌ها» is seen only by the chaacme team, so existing
// values must NOT become public when the person profile starts showing credentials. The new flag defaults
// to 0 for every existing row; only an explicit opt-in (through the normal review flow, or the admin) turns it on.
export default {
  id: 5,
  name: 'credentials_public',
  up(db) {
    if (!hasColumn(db, 'hosts', 'credentials_public')) db.exec('ALTER TABLE hosts ADD COLUMN credentials_public INTEGER NOT NULL DEFAULT 0');
  }
};
