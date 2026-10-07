import { hasColumn } from '../migrate.js';

// How a tour is reserved, and what a partner is called on one tour. Additive only; every existing row keeps
// today's behaviour (booking_mode defaults to 'online', everything else is empty), nothing is backfilled.
//
//   tours.booking_mode   'online' | 'external' | 'none'  (default 'online'; the site-wide switch
//                        BOOKING_ONLINE_ENABLED decides whether 'online' actually books, see server/booking.js)
//   tours.booking_url    https:// / tel: / mailto: link of the reservation button (<= 300), validated in the app
//                        (deploy/assets/js/shared/booking.js)
//   tours.booking_label  text of that button (<= 40), default «رزرو»
//   tours.booking_note   one plain-text line shown with the dates (<= 200)
//   tour_hosts.role_label  what the partner card says instead of «برگزارکننده» for this link (<= 40, plain text)
//
// The previous release (2b565cc) never names these columns, so it boots and runs on a migrated database.
export default {
  id: 7,
  name: 'booking_mode_role_label',
  up(db) {
    const add = (table, column, ddl) => {
      // a table that does not exist has nothing to alter (a database older than the schema's bootstrap, as the migration tests build)
      if (!db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table)) return;
      if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    };
    add('tours', 'booking_mode', `booking_mode TEXT NOT NULL DEFAULT 'online' CHECK (booking_mode IN ('online','external','none'))`);
    add('tours', 'booking_url', 'booking_url TEXT');
    add('tours', 'booking_label', `booking_label TEXT DEFAULT 'رزرو'`);
    add('tours', 'booking_note', 'booking_note TEXT');
    add('tour_hosts', 'role_label', 'role_label TEXT');
  }
};
