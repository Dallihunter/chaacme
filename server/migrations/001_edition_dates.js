import { hasColumn } from '../migrate.js';

// An "edition" is one bookable run of a tour. It lives in tour_dates (bookings
// already reference it by id), which until now carried only a free-text Persian
// label. These columns add the machine-readable date: ISO YYYY-MM-DD
// (Gregorian), which is what lets "upcoming / past" be computed.
//
// Existing rows are deliberately left NULL. A label like "۱۲ مهر" has no year,
// so any backfill would be a guess; an admin sets the real date per edition.
export default {
  id: 1,
  name: 'edition_dates',
  up(db) {
    if (!hasColumn(db, 'tour_dates', 'starts_on')) db.exec('ALTER TABLE tour_dates ADD COLUMN starts_on TEXT');
    if (!hasColumn(db, 'tour_dates', 'ends_on')) db.exec('ALTER TABLE tour_dates ADD COLUMN ends_on TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_tour_dates_starts ON tour_dates(tour_id, starts_on)');
  }
};
