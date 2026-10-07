import { hasColumn } from '../migrate.js';

// Image paths are stored as /images/<dir>/<file> and validated against that shape (server/util.js). Two tours imported
// before that rule (animal-flow and dasbagh in production) have gallery rows written as images/<dir>/<file>, without the
// leading slash: the public pages refuse such a path (describeImage), so their cards showed an empty frame, their galleries
// did not render, the admin's thumbnails resolved against /admin/ and 404ed, and adding a photo failed because the editor
// re-sends the whole list and the validator rejects the old entries. Only the leading slash is missing; the files are where
// the absolute path says they are. Rows that already start with "/" are not touched, so this is a no-op on a clean database.
const COLUMNS = [
  ['tour_media', 'image_path'],
  ['tours', 'photo_path'],
  ['tour_highlights', 'image_path'],
  ['tour_itinerary', 'photo_path'],
  ['hosts', 'photo_path'],
  ['host_media', 'path']
];

export default {
  id: 6,
  name: 'absolute_image_paths',
  up(db) {
    for (const [table, column] of COLUMNS) {
      if (!hasColumn(db, table, column)) continue;
      db.prepare(`UPDATE ${table} SET ${column} = '/' || ${column} WHERE ${column} LIKE 'images/%'`).run();
    }
  }
};
