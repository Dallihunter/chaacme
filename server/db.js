import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

export const DB_PATH = process.env.CHAACME_PLATFORM_DB || join(root, 'data', 'platform.db');

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  -- ------------------------------------------------------------------------
  -- Catalog
  -- ------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS tours (
    id           TEXT PRIMARY KEY,
    status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','coming_soon','archived')),
    featured     INTEGER NOT NULL DEFAULT 0,
    ordinal      INTEGER NOT NULL DEFAULT 0,
    name         TEXT NOT NULL,
    subtitle_en  TEXT,
    tags         TEXT,
    duration     TEXT,
    price        INTEGER,
    description  TEXT,
    included     TEXT,
    -- Card display copy, independent of the live booking calendar (tour_dates)
    -- -- same relationship the mock frontend this was ported from used: a tour
    -- can carry curated day/month/photo for its Experiences-grid card even
    -- when its real bookable dates (or lack thereof) say something else.
    photo_path   TEXT,
    day_label    TEXT,
    month_label  TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tour_media (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    tour_id    TEXT NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
    ordinal    INTEGER NOT NULL DEFAULT 0,
    label      TEXT,
    image_path TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tour_media_tour ON tour_media(tour_id, ordinal);

  CREATE TABLE IF NOT EXISTS tour_highlights (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tour_id     TEXT NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
    ordinal     INTEGER NOT NULL DEFAULT 0,
    name        TEXT NOT NULL,
    description TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tour_highlights_tour ON tour_highlights(tour_id, ordinal);

  CREATE TABLE IF NOT EXISTS tour_itinerary (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tour_id     TEXT NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
    ordinal     INTEGER NOT NULL DEFAULT 0,
    time_label  TEXT,
    title       TEXT NOT NULL,
    description TEXT,
    photo_label TEXT,
    photo_path  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tour_itinerary_tour ON tour_itinerary(tour_id, ordinal);

  -- Curated per-category rating snapshot shown on the tour page (e.g. "Food:
  -- 4.6"). Not derived from reviews because the review form only collects a
  -- single overall star rating — these are editorial/aggregate figures an
  -- admin sets, same idea as content in the marketing site.
  CREATE TABLE IF NOT EXISTS tour_review_categories (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    tour_id TEXT NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL DEFAULT 0,
    label   TEXT NOT NULL,
    score   REAL NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tour_review_categories_tour ON tour_review_categories(tour_id, ordinal);

  -- Bookable occurrences. seats_taken is the source of truth for both the
  -- displayed availability label and booking capacity checks.
  CREATE TABLE IF NOT EXISTS tour_dates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    tour_id     TEXT NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
    label       TEXT NOT NULL,
    capacity    INTEGER NOT NULL DEFAULT 0,
    seats_taken INTEGER NOT NULL DEFAULT 0,
    closed      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_tour_dates_tour ON tour_dates(tour_id, id);

  -- ------------------------------------------------------------------------
  -- Accounts + phone/OTP auth
  -- ------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    phone      TEXT UNIQUE NOT NULL,
    first_name TEXT NOT NULL,
    last_name  TEXT NOT NULL,
    username   TEXT UNIQUE NOT NULL,
    status     TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Codes are never stored in plaintext. attempts caps brute-forcing a single
  -- issued code; the rate_limit table below caps how often new codes can be
  -- requested per phone/IP.
  CREATE TABLE IF NOT EXISTS otp_codes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    phone       TEXT NOT NULL,
    code_hash   TEXT NOT NULL,
    attempts    INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    expires_at  INTEGER NOT NULL,
    consumed_at TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_otp_phone ON otp_codes(phone, id DESC);

  -- Short-lived ticket bridging "OTP verified" to "profile submitted" for a
  -- brand-new phone number, so an unauthenticated caller can never mint a
  -- session by POSTing straight to /api/auth/profile without having proven
  -- phone ownership first.
  CREATE TABLE IF NOT EXISTS signup_tickets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT UNIQUE NOT NULL,
    phone      TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    consumed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Opaque bearer tokens, DB-backed so logout / admin revocation actually
  -- works. Only the hash is stored -- a DB read alone can't be replayed as a
  -- session, same reasoning as the otp_codes table.
  CREATE TABLE IF NOT EXISTS sessions (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash   TEXT UNIQUE NOT NULL,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at   INTEGER NOT NULL,
    last_seen_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  -- ------------------------------------------------------------------------
  -- Admin accounts + sessions (separate from the phone/OTP user system above
  -- on purpose: different login flow, different session cookie, and this
  -- table is never touched by anything under /api/auth/*).
  -- ------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS admin_users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS admin_sessions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash    TEXT UNIQUE NOT NULL,
    admin_user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at    INTEGER NOT NULL,
    last_seen_at  TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(admin_user_id);

  -- ------------------------------------------------------------------------
  -- Bookings + reviews
  -- ------------------------------------------------------------------------
  CREATE TABLE IF NOT EXISTS bookings (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    ref              TEXT UNIQUE NOT NULL,
    tour_id          TEXT NOT NULL REFERENCES tours(id),
    tour_date_id     INTEGER NOT NULL REFERENCES tour_dates(id),
    user_id          INTEGER NOT NULL REFERENCES users(id),
    guests           INTEGER NOT NULL DEFAULT 1 CHECK (guests BETWEEN 1 AND 8),
    price_per_person INTEGER NOT NULL,
    total            INTEGER NOT NULL,
    status           TEXT NOT NULL DEFAULT 'pending_payment'
                       CHECK (status IN ('pending_payment','confirmed','cancelled')),
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_bookings_user ON bookings(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS reviews (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    tour_id      TEXT NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
    user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
    display_name TEXT NOT NULL,
    rating       INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
    body         TEXT NOT NULL,
    status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','published','rejected')),
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_reviews_tour ON reviews(tour_id, status, created_at DESC);

  -- Fixed-window rate limiting, persisted so restarts don't reset it.
  CREATE TABLE IF NOT EXISTS rate_limit (
    bucket       TEXT PRIMARY KEY,
    hits         INTEGER NOT NULL,
    window_start INTEGER NOT NULL
  );

  -- ------------------------------------------------------------------------
  -- Organizers ("hosts")
  -- ------------------------------------------------------------------------
  -- user_id is deliberately nullable and unused for now: hosts are
  -- admin-managed in this phase. It exists so a later phase can let an
  -- approved host log in and edit their own profile without a migration.
  --
  -- contact_phone is internal-only (admins call the organizer on it) and is
  -- never part of any public response — see publicHostFields below.
  --
  -- instagram_handle stores the bare handle, no @ and no URL: the frontend
  -- builds https://instagram.com/<handle> itself, so a stored value can
  -- never turn into an arbitrary link pointing somewhere else.
  CREATE TABLE IF NOT EXISTS hosts (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    slug             TEXT UNIQUE NOT NULL,
    display_name     TEXT NOT NULL,
    photo_path       TEXT,
    bio              TEXT,
    expertise        TEXT,
    instagram_handle TEXT,
    contact_phone    TEXT,
    user_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind             TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person','place')),
    -- Place-only columns. Nullable and ignored entirely for kind='person':
    -- a person has no region and no coordinates, and validation strips these
    -- rather than storing values that would never be read.
    region           TEXT,
    lodging_type     TEXT,
    amenities        TEXT,
    latitude         REAL,
    longitude        REAL,
    status           TEXT NOT NULL DEFAULT 'hidden' CHECK (status IN ('active','hidden')),
    verified_at      TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );
  -- One account can own several profiles (a coach who also runs a lodge), so
  -- this is a plain index, never UNIQUE.
  CREATE INDEX IF NOT EXISTS idx_hosts_user ON hosts(user_id);

  -- Gallery images for a profile. Mostly a place thing (rooms, grounds), but
  -- nothing stops a person using it. path follows the same /images/... shape
  -- as hosts.photo_path and is validated identically before it is stored.
  CREATE TABLE IF NOT EXISTS host_media (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    host_id    INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    path       TEXT NOT NULL,
    caption    TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_host_media_host ON host_media(host_id, sort_order);

  -- Which organizers run which tour. role/sort_order drive display order on
  -- the tour page (lead first, then sort_order).
  CREATE TABLE IF NOT EXISTS tour_hosts (
    tour_id    TEXT NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
    host_id    INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'lead' CHECK (role IN ('lead','co_host','venue')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tour_id, host_id)
  );
  CREATE INDEX IF NOT EXISTS idx_tour_hosts_host ON tour_hosts(host_id);

  -- Public "become an organizer" submissions. Approving one creates a hosts
  -- row (hidden) and links it here via host_id, so the application stays as
  -- an audit trail of what was originally submitted.
  --
  -- ip_hash is the salted hash from hashIp(), never a raw IP.
  --
  -- Applying requires a logged-in account: user_id identifies the applicant
  -- and their phone is read from users at display time rather than copied in
  -- here, so there is one source of truth for it. The column stays nullable
  -- only because rows predating the account requirement have no user; every
  -- new row is written with one (see createHostApplication).
  --
  -- full_name is the PUBLIC profile name being proposed (a person's display
  -- name, or the place's name) -- not the applicant's legal name, which is
  -- already on their account.
  CREATE TABLE IF NOT EXISTS host_applications (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
    kind             TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person','place')),
    full_name        TEXT NOT NULL,
    phone            TEXT,
    instagram_handle TEXT,
    expertise        TEXT,
    region           TEXT,
    lodging_type     TEXT,
    description      TEXT,
    status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    admin_note       TEXT,
    host_id          INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
    ip_hash          TEXT,
    created_at       TEXT NOT NULL DEFAULT (datetime('now')),
    reviewed_at      TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_host_applications_status ON host_applications(status, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_host_applications_phone ON host_applications(phone, status);
`);

// Additive column migration, same idempotent-bootstrap philosophy as the
// CREATE TABLE IF NOT EXISTS block above: safe to run on every boot, no-op
// once applied. This project has no separate migration runner, so new
// columns land here rather than as a one-off hand-edit of the live .db file.
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('tours', 'photo_path', 'photo_path TEXT');
ensureColumn('tours', 'day_label', 'day_label TEXT');
ensureColumn('tours', 'month_label', 'month_label TEXT');
ensureColumn('tour_itinerary', 'photo_path', 'photo_path TEXT');
// JSON array of image paths (same idea as tour_media, but a stage's photos
// live inline on its row since itinerary is a bulk replace-all collection
// with no stable per-row ids exposed to the client — see replaceTourChildren.
ensureColumn('tour_itinerary', 'photos', 'photos TEXT');
// Nullable: OTP-only users never set a password, so absence is a valid state, not a bug.
ensureColumn('users', 'password_hash', 'password_hash TEXT');
// ZarinPal payment tracking. Kept separate from the pre-existing `status`
// column (pending_payment/confirmed/cancelled, still hand-set by admins) —
// payment_status is one of pending/paid/failed/canceled/paid_no_capacity and
// is what the ZarinPal callback drives. See confirmBookingPayment below.
ensureColumn('bookings', 'payment_status', "payment_status TEXT NOT NULL DEFAULT 'pending'");
ensureColumn('bookings', 'zarinpal_authority', 'zarinpal_authority TEXT');
ensureColumn('bookings', 'zarinpal_ref_id', 'zarinpal_ref_id TEXT');
ensureColumn('bookings', 'paid_at', 'paid_at TEXT');

// --- partner profiles: person vs place ------------------------------------
//
// `kind` splits a profile into a PERSON (a coach, guide, facilitator) and a
// PLACE (a lodge, garden, venue). The place columns below are nullable and
// meaningless for a person, so they are added rather than split into a second
// table: every read path already loads a whole hosts row, and a join would
// buy nothing but an extra query.
//
// SQLite accepts a CHECK on an added column, so these are plain ALTERs. The
// two rebuilds further down exist only because SQLite cannot change a CHECK
// that is already part of a table definition.
ensureColumn('hosts', 'kind', "kind TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person','place'))");
ensureColumn('hosts', 'region', 'region TEXT');
ensureColumn('hosts', 'lodging_type', 'lodging_type TEXT');
// JSON array of short strings ("وای‌فای", "صبحانه"). Same inline-JSON choice
// as tour_itinerary.photos: a replace-all list with no stable per-item id.
ensureColumn('hosts', 'amenities', 'amenities TEXT');
// Stored at full precision because the admin needs an accurate pin to work
// with; the PUBLIC projection rounds to 2 decimals (~1 km) and never emits
// these raw -- see publicHostFields.
ensureColumn('hosts', 'latitude', 'latitude REAL');
ensureColumn('hosts', 'longitude', 'longitude REAL');
db.exec('CREATE INDEX IF NOT EXISTS idx_hosts_user ON hosts(user_id)');

function tableSql(name) {
  const row = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`).get(name);
  return row ? row.sql : null;
}

/**
 * Rebuild a table whose CHECK constraint (or NOT NULL) has to change.
 *
 * SQLite can only alter a CHECK by recreating the table, so this runs the
 * documented 12-step procedure: foreign keys off, copy into a new table,
 * swap, foreign keys back on. `needed(sql)` inspects the stored CREATE
 * statement, which makes the whole thing idempotent -- once the new
 * definition is in place it never runs again.
 *
 * PRAGMA foreign_keys is a no-op inside a transaction, so it is toggled
 * outside the BEGIN deliberately.
 */
function rebuildTable(name, needed, createSql, copySql, afterSql = []) {
  const sql = tableSql(name);
  if (!sql || !needed(sql)) return false;
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN');
  try {
    db.exec(createSql.replace(new RegExp(`\\b${name}\\b`), `${name}__new`));
    db.exec(copySql.replace(/__NEW__/g, `${name}__new`));
    db.exec(`DROP TABLE ${name}`);
    db.exec(`ALTER TABLE ${name}__new RENAME TO ${name}`);
    for (const stmt of afterSql) db.exec(stmt);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    db.exec('PRAGMA foreign_keys = ON');
    throw err;
  }
  db.exec('PRAGMA foreign_keys = ON');
  return true;
}

// tour_hosts.role gains 'venue' -- a place is linked to a tour through the
// same table as its people, so one query answers "who and where".
rebuildTable(
  'tour_hosts',
  (sql) => !/'venue'/.test(sql),
  `CREATE TABLE tour_hosts (
     tour_id    TEXT NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
     host_id    INTEGER NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
     role       TEXT NOT NULL DEFAULT 'lead' CHECK (role IN ('lead','co_host','venue')),
     sort_order INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (tour_id, host_id)
   )`,
  `INSERT INTO __NEW__ (tour_id, host_id, role, sort_order)
     SELECT tour_id, host_id, role, sort_order FROM tour_hosts`,
  ['CREATE INDEX IF NOT EXISTS idx_tour_hosts_host ON tour_hosts(host_id)']
);

// host_applications gains user_id/kind/region/lodging_type, and `phone` stops
// being NOT NULL: the applicant's phone now lives on their account and is
// read from there, so an application row no longer carries its own copy.
rebuildTable(
  'host_applications',
  (sql) => !/\buser_id\b/.test(sql) || /phone\s+TEXT\s+NOT NULL/.test(sql),
  `CREATE TABLE host_applications (
     id               INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
     kind             TEXT NOT NULL DEFAULT 'person' CHECK (kind IN ('person','place')),
     full_name        TEXT NOT NULL,
     phone            TEXT,
     instagram_handle TEXT,
     expertise        TEXT,
     region           TEXT,
     lodging_type     TEXT,
     description      TEXT,
     status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
     admin_note       TEXT,
     host_id          INTEGER REFERENCES hosts(id) ON DELETE SET NULL,
     ip_hash          TEXT,
     created_at       TEXT NOT NULL DEFAULT (datetime('now')),
     reviewed_at      TEXT
   )`,
  `INSERT INTO __NEW__ (id, full_name, phone, instagram_handle, expertise, description,
                        status, admin_note, host_id, ip_hash, created_at, reviewed_at)
     SELECT id, full_name, phone, instagram_handle, expertise, description,
            status, admin_note, host_id, ip_hash, created_at, reviewed_at FROM host_applications`,
  [
    `CREATE INDEX IF NOT EXISTS idx_host_applications_status ON host_applications(status, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_host_applications_phone ON host_applications(phone, status)`
  ]
);
// After the rebuild, never inside the bootstrap CREATE block at the top of
// this file: on an existing database that block runs while host_applications
// still has its old columns, and indexing user_id there fails the boot.
db.exec('CREATE INDEX IF NOT EXISTS idx_host_applications_user ON host_applications(user_id, created_at DESC)');

/** Availability status + booking eligibility derived from live capacity — never stored as static copy. */
export function dateAvailability(capacity, seatsTaken, closed) {
  const available = Math.max(0, capacity - seatsTaken);
  if (closed || available <= 0) return { status: 'تکمیل ظرفیت', disabled: true, available: 0 };
  const lowStock = available <= Math.max(2, Math.ceil(capacity * 0.2));
  return { status: lowStock ? 'ظرفیت محدود' : 'رزرو باز است', disabled: false, available };
}

const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

/** Formats an integer Toman price as Farsi-digit, thousands-separated display copy (e.g. 23000000 -> "۲۳٬۰۰۰٬۰۰۰ تومان"). Derived at read time, never stored, so it can never drift from `price`. */
function formatPriceLine(price) {
  if (price == null) return null;
  const grouped = Math.round(price).toLocaleString('en-US').replace(/,/g, '٬');
  return grouped.replace(/\d/g, (d) => FA_DIGITS[d]) + ' تومان';
}

function reviewSummary(tourId) {
  const row = db.prepare(
    `SELECT COUNT(*) AS count, AVG(rating) AS average FROM reviews WHERE tour_id = ? AND status = 'published'`
  ).get(tourId);
  return { count: row.count, average: row.count ? Math.round(row.average * 10) / 10 : null };
}

/** Seed the catalog once. Re-running is a no-op unless force is set. */
export function seed({ force = false } = {}) {
  const seedData = JSON.parse(readFileSync(join(here, 'content.seed.json'), 'utf8'));
  const existing = db.prepare('SELECT COUNT(*) AS n FROM tours').get().n;
  if (existing > 0 && !force) return { seeded: false };

  const putTour = db.prepare(
    `INSERT INTO tours (id, status, featured, ordinal, name, subtitle_en, tags, duration, price, description, included, photo_path, day_label, month_label)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       status = excluded.status, featured = excluded.featured, ordinal = excluded.ordinal,
       name = excluded.name, subtitle_en = excluded.subtitle_en, tags = excluded.tags,
       duration = excluded.duration, price = excluded.price, description = excluded.description,
       included = excluded.included, photo_path = excluded.photo_path,
       day_label = excluded.day_label, month_label = excluded.month_label, updated_at = datetime('now')`
  );
  const clearChildren = (table) => db.prepare(`DELETE FROM ${table} WHERE tour_id = ?`);
  const delMedia = clearChildren('tour_media');
  const delHighlights = clearChildren('tour_highlights');
  const delItinerary = clearChildren('tour_itinerary');
  const delCategories = clearChildren('tour_review_categories');
  const delDates = clearChildren('tour_dates');

  const putMedia = db.prepare('INSERT INTO tour_media (tour_id, ordinal, label, image_path) VALUES (?, ?, ?, ?)');
  const putHighlight = db.prepare(
    'INSERT INTO tour_highlights (tour_id, ordinal, name, description) VALUES (?, ?, ?, ?)'
  );
  const putItinerary = db.prepare(
    'INSERT INTO tour_itinerary (tour_id, ordinal, time_label, title, description, photo_label, photo_path, photos) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  const putCategory = db.prepare(
    'INSERT INTO tour_review_categories (tour_id, ordinal, label, score) VALUES (?, ?, ?, ?)'
  );
  const putDate = db.prepare(
    'INSERT INTO tour_dates (tour_id, label, capacity, seats_taken, closed) VALUES (?, ?, ?, ?, ?)'
  );
  // Reviews are deliberately not seeded and not cleared here: they are
  // user-generated content, so inventing them would put fabricated social
  // proof in front of customers, and clearing them would destroy real
  // submissions on a forced reseed. seed() owns the catalog only.
  for (const t of seedData.tours) {
    putTour.run(t.id, t.status, t.featured ? 1 : 0, t.ordinal, t.name, t.subtitleEn || null,
      t.tags || null, t.duration || null, t.price ?? null, t.description || null, t.included || null,
      t.photoPath || null, t.dayLabel || null, t.monthLabel || null);
    delMedia.run(t.id); delHighlights.run(t.id); delItinerary.run(t.id);
    delCategories.run(t.id); delDates.run(t.id);

    (t.gallery || []).forEach((label, i) => putMedia.run(t.id, i, label, t.galleryPhotos?.[i] || null));
    (t.highlights || []).forEach((h, i) => putHighlight.run(t.id, i, h.name, h.description));
    (t.itinerary || []).forEach((it, i) =>
      putItinerary.run(t.id, i, it.time, it.title, it.description, it.photoLabel, it.photoPath || null,
        JSON.stringify(it.photos || [])));
    (t.reviewCategories || []).forEach((c, i) => putCategory.run(t.id, i, c.label, c.score));
    (t.dates || []).forEach((d) => putDate.run(t.id, d.label, d.capacity, d.seatsTaken || 0, d.closed ? 1 : 0));
  }

  return { seeded: true, tours: seedData.tours.length };
}

function tourDates(tourId) {
  return db.prepare('SELECT * FROM tour_dates WHERE tour_id = ? ORDER BY id').all(tourId).map((d) => ({
    id: d.id,
    label: d.label,
    ...dateAvailability(d.capacity, d.seats_taken, d.closed)
  }));
}

/** Public catalog listing: published + coming_soon tours, ordered for display. */
export function listTours() {
  const rows = db.prepare(
    `SELECT * FROM tours WHERE status IN ('published','coming_soon') ORDER BY ordinal`
  ).all();
  return rows.map((t) => {
    const dates = t.status === 'published' ? tourDates(t.id) : [];
    const nextDate = dates.find((d) => !d.disabled) || dates[0] || null;
    return {
      id: t.id, status: t.status, active: !!t.featured, featured: !!t.featured, name: t.name, tags: t.tags,
      duration: t.duration, price: t.price, priceLine: formatPriceLine(t.price), photoPath: t.photo_path,
      date: (t.day_label && t.month_label) ? { day: t.day_label, month: t.month_label } : null,
      comingSoon: t.status === 'coming_soon',
      nextDate: nextDate ? { label: nextDate.label, available: nextDate.available } : null,
      availability: nextDate ? nextDate.status : null,
      seats: nextDate ? nextDate.status : null,
      review: reviewSummary(t.id),
      hosts: tourHostsPublic(t.id)
    };
  });
}

function tourDetailFields(t) {
  const id = t.id;
  const media = db.prepare('SELECT id, label, image_path FROM tour_media WHERE tour_id = ? ORDER BY ordinal').all(id);
  return {
    id: t.id, status: t.status, active: !!t.featured, featured: !!t.featured, name: t.name,
    subtitleEn: t.subtitle_en, tags: t.tags, duration: t.duration, price: t.price,
    priceLine: formatPriceLine(t.price), description: t.description, included: t.included,
    photoPath: t.photo_path,
    date: (t.day_label && t.month_label) ? { day: t.day_label, month: t.month_label } : null,
    gallery: media.map((r) => r.label),
    galleryPhotos: media.map((r) => r.image_path).filter(Boolean),
    // Same data as gallery/galleryPhotos, but carrying each row's stable id
    // so the admin UI can target one photo for delete/reorder without
    // relying on array position (which the replace-array PUT would shift).
    galleryMedia: media.map((r) => ({ id: r.id, label: r.label, photoPath: r.image_path })),
    highlights: db.prepare('SELECT name, description FROM tour_highlights WHERE tour_id = ? ORDER BY ordinal').all(id),
    itinerary: db.prepare(
      'SELECT time_label AS time, title, description, photo_label AS photoLabel, photo_path AS photoPath, photos FROM tour_itinerary WHERE tour_id = ? ORDER BY ordinal'
    ).all(id).map((it) => ({ ...it, photos: it.photos ? JSON.parse(it.photos) : [] })),
    reviewCategories: db.prepare(
      'SELECT label, score FROM tour_review_categories WHERE tour_id = ? ORDER BY ordinal'
    ).all(id),
    reviewSummary: reviewSummary(id),
    hosts: tourHostsPublic(id),
    reviews: db.prepare(
      `SELECT display_name AS displayName, rating, body, created_at AS createdAt
       FROM reviews WHERE tour_id = ? AND status = 'published' ORDER BY created_at DESC LIMIT 50`
    ).all(id),
    bookingDates: tourDates(id)
  };
}

/** Full detail for a single published tour, or null if it doesn't exist / isn't visible. */
export function getTourDetail(id) {
  const t = db.prepare(`SELECT * FROM tours WHERE id = ? AND status IN ('published','coming_soon')`).get(id);
  if (!t) return null;
  return tourDetailFields(t);
}

/** Same shape as getTourDetail, but visible regardless of status (draft/archived included) — for building an admin edit view. */
export function getTourDetailAdmin(id) {
  const t = db.prepare('SELECT * FROM tours WHERE id = ?').get(id);
  if (!t) return null;
  return tourDetailFields(t);
}

// --- admin: catalog -------------------------------------------------------

export function listToursAdmin() {
  return db.prepare('SELECT * FROM tours ORDER BY ordinal').all();
}

// Bulk replace-all for a tour's editorial child collections (gallery,
// highlights, itinerary, review categories) — the same pattern seed() has
// always used, just scoped to one tour instead of the whole catalog. Deliberately
// excludes tour_dates: those carry live capacity state and FK'd bookings, so
// they stay managed one at a time via addTourDate/updateTourDate instead of
// delete-and-reinsert.
function replaceTourChildren(tourId, data) {
  if ('highlights' in data) {
    db.prepare('DELETE FROM tour_highlights WHERE tour_id = ?').run(tourId);
    const put = db.prepare('INSERT INTO tour_highlights (tour_id, ordinal, name, description) VALUES (?, ?, ?, ?)');
    data.highlights.forEach((h, i) => put.run(tourId, i, h.name, h.description ?? h.desc ?? null));
  }
  if ('itinerary' in data) {
    db.prepare('DELETE FROM tour_itinerary WHERE tour_id = ?').run(tourId);
    const put = db.prepare(
      'INSERT INTO tour_itinerary (tour_id, ordinal, time_label, title, description, photo_label, photo_path, photos) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    data.itinerary.forEach((it, i) =>
      put.run(tourId, i, it.time ?? null, it.title, it.description ?? it.text ?? null,
        it.photoLabel ?? null, it.photo ?? it.photoPath ?? null,
        JSON.stringify(Array.isArray(it.photos) ? it.photos : [])));
  }
  if ('gallery' in data || 'galleryImages' in data || 'galleryPhotos' in data) {
    db.prepare('DELETE FROM tour_media WHERE tour_id = ?').run(tourId);
    const labels = data.galleryImages ?? data.gallery ?? [];
    const photos = data.galleryPhotos ?? [];
    const put = db.prepare('INSERT INTO tour_media (tour_id, ordinal, label, image_path) VALUES (?, ?, ?, ?)');
    for (let i = 0; i < Math.max(labels.length, photos.length); i++) {
      put.run(tourId, i, labels[i] ?? null, photos[i] ?? null);
    }
  }
  if ('reviewCategories' in data) {
    db.prepare('DELETE FROM tour_review_categories WHERE tour_id = ?').run(tourId);
    const put = db.prepare('INSERT INTO tour_review_categories (tour_id, ordinal, label, score) VALUES (?, ?, ?, ?)');
    data.reviewCategories.forEach((c, i) => put.run(tourId, i, c.label, c.score));
  }
}

export function createTour(t) {
  db.exec('BEGIN');
  try {
    db.prepare(
      `INSERT INTO tours (id, status, featured, ordinal, name, subtitle_en, tags, duration, price, description, included, photo_path, day_label, month_label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(t.id, t.status || 'draft', t.featured ? 1 : 0, t.ordinal ?? 0, t.name, t.subtitleEn ?? null,
      t.tags ?? null, t.duration ?? null, t.price ?? null, t.description ?? null, t.included ?? null,
      t.photoPath ?? null, t.dayLabel ?? null, t.monthLabel ?? null);
    replaceTourChildren(t.id, t);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return db.prepare('SELECT * FROM tours WHERE id = ?').get(t.id);
}

const TOUR_FIELDS = {
  status: 'status', featured: 'featured', ordinal: 'ordinal', name: 'name', subtitleEn: 'subtitle_en',
  tags: 'tags', duration: 'duration', price: 'price', description: 'description', included: 'included',
  photoPath: 'photo_path', dayLabel: 'day_label', monthLabel: 'month_label'
};

export function updateTour(id, patch) {
  const sets = [];
  const args = [];
  for (const [key, column] of Object.entries(TOUR_FIELDS)) {
    if (!(key in patch)) continue;
    sets.push(`${column} = ?`);
    args.push(key === 'featured' ? (patch[key] ? 1 : 0) : patch[key]);
  }
  db.exec('BEGIN');
  try {
    if (sets.length) {
      db.prepare(`UPDATE tours SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...args, id);
    }
    replaceTourChildren(id, patch);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return db.prepare('SELECT * FROM tours WHERE id = ?').get(id);
}

export function tourExists(id) {
  return !!db.prepare('SELECT 1 FROM tours WHERE id = ?').get(id);
}

export class TourDeleteError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/**
 * Deletes a tour and its editorial children (gallery/highlights/itinerary/
 * review categories/dates/reviews cascade via FK). `bookings` has no cascade
 * on tour_id by design — a tour with real booking history must be archived
 * (status='archived'), not deleted, so this throws instead of silently
 * orphaning or destroying that history.
 */
export function deleteTour(id) {
  const hasBookings = db.prepare('SELECT 1 FROM bookings WHERE tour_id = ? LIMIT 1').get(id);
  if (hasBookings) throw new TourDeleteError('has_bookings');
  db.prepare('DELETE FROM tours WHERE id = ?').run(id);
}

/**
 * Removes one gallery photo by its tour_media id and renumbers the
 * remaining rows' ordinals to stay contiguous. Returns the deleted row's
 * image_path (so the caller can unlink the file), null if it had none, or
 * undefined if no matching row existed for that tour.
 */
export function deleteTourMedia(tourId, mediaId) {
  const row = db.prepare('SELECT * FROM tour_media WHERE id = ? AND tour_id = ?').get(mediaId, tourId);
  if (!row) return undefined;
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM tour_media WHERE id = ?').run(mediaId);
    const rest = db.prepare('SELECT id FROM tour_media WHERE tour_id = ? ORDER BY ordinal').all(tourId);
    const reorder = db.prepare('UPDATE tour_media SET ordinal = ? WHERE id = ?');
    rest.forEach((r, i) => reorder.run(i, r.id));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return row.image_path;
}

/** Reassigns ordinals to match `orderIds` (a permutation of that tour's existing tour_media ids). Throws if it isn't an exact permutation. */
export function reorderTourMedia(tourId, orderIds) {
  const existing = db.prepare('SELECT id FROM tour_media WHERE tour_id = ?').all(tourId).map((r) => r.id);
  const existingSet = new Set(existing);
  const requestedSet = new Set(orderIds);
  if (orderIds.length !== existing.length || existingSet.size !== requestedSet.size
    || ![...existingSet].every((id) => requestedSet.has(id))) {
    throw new Error('order_mismatch');
  }
  db.exec('BEGIN');
  try {
    const reorder = db.prepare('UPDATE tour_media SET ordinal = ? WHERE id = ? AND tour_id = ?');
    orderIds.forEach((mediaId, i) => reorder.run(i, mediaId, tourId));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return db.prepare('SELECT id, label, image_path FROM tour_media WHERE tour_id = ? ORDER BY ordinal').all(tourId);
}

export function addTourDate(tourId, { label, capacity }) {
  const info = db.prepare(
    'INSERT INTO tour_dates (tour_id, label, capacity, seats_taken, closed) VALUES (?, ?, ?, 0, 0)'
  ).run(tourId, label, capacity);
  return db.prepare('SELECT * FROM tour_dates WHERE id = ?').get(Number(info.lastInsertRowid));
}

export function updateTourDate(id, patch) {
  const sets = [];
  const args = [];
  if ('capacity' in patch) { sets.push('capacity = ?'); args.push(patch.capacity); }
  if ('closed' in patch) { sets.push('closed = ?'); args.push(patch.closed ? 1 : 0); }
  if (!sets.length) return db.prepare('SELECT * FROM tour_dates WHERE id = ?').get(id);
  args.push(id);
  db.prepare(`UPDATE tour_dates SET ${sets.join(', ')} WHERE id = ?`).run(...args);
  return db.prepare('SELECT * FROM tour_dates WHERE id = ?').get(id);
}

// --- bookings ---------------------------------------------------------------

export class BookingError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/**
 * Records a pending booking. Seats are NOT reserved here — a booking created
 * but never paid for must not hold a seat forever, so capacity is only
 * checked (softly, for UX) here and actually, atomically decremented in
 * confirmBookingPayment below, at the moment ZarinPal confirms payment.
 */
export function createBooking({ userId, tourId, tourDateId, guests }) {
  const tourDate = db.prepare(
    'SELECT * FROM tour_dates WHERE id = ? AND tour_id = ?'
  ).get(tourDateId, tourId);
  if (!tourDate) throw new BookingError('date_not_found');

  const tour = db.prepare(`SELECT * FROM tours WHERE id = ? AND status = 'published'`).get(tourId);
  if (!tour) throw new BookingError('tour_not_found');

  const avail = dateAvailability(tourDate.capacity, tourDate.seats_taken, tourDate.closed);
  if (avail.disabled || avail.available < guests) throw new BookingError('not_enough_seats');

  const ref = 'CHK-' + Math.floor(10000 + Math.random() * 89999);
  const total = tour.price * guests;
  const info = db.prepare(
    `INSERT INTO bookings (ref, tour_id, tour_date_id, user_id, guests, price_per_person, total, status, payment_status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_payment', 'pending')`
  ).run(ref, tourId, tourDateId, userId, guests, tour.price, total);

  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(Number(info.lastInsertRowid));
}

export function getBookingById(id) {
  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
}

export function getBookingByAuthority(authority) {
  return db.prepare('SELECT * FROM bookings WHERE zarinpal_authority = ?').get(authority);
}

/** Booking row plus the tour name needed for the ZarinPal request description. */
export function getBookingWithTourName(id) {
  return db.prepare(
    `SELECT b.*, t.name AS tourName FROM bookings b JOIN tours t ON t.id = b.tour_id WHERE b.id = ?`
  ).get(id);
}

export function setBookingAuthority(id, authority) {
  db.prepare('UPDATE bookings SET zarinpal_authority = ? WHERE id = ?').run(authority, id);
}

/** Marks a still-pending booking as failed. A no-op if it was already resolved (idempotent). */
export function markBookingPaymentFailed(id) {
  db.prepare(`UPDATE bookings SET payment_status = 'failed' WHERE id = ? AND payment_status = 'pending'`).run(id);
  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
}

/**
 * Called once ZarinPal has confirmed payment for a booking. Idempotent: a
 * booking whose payment_status is no longer 'pending' (already paid, failed,
 * or paid_no_capacity — e.g. the callback fired twice) is returned unchanged
 * rather than reprocessed.
 *
 * Capacity is checked and reserved atomically right here, guarded by the same
 * WHERE-clause pattern createBooking used to use: if another booking already
 * exhausted the seats between request and verification, this UPDATE is a
 * no-op (changes === 0) and the booking is marked 'paid_no_capacity' instead
 * of 'confirmed' — payment succeeded but the seat could not be secured, never
 * silently double-decremented or oversold.
 */
export function confirmBookingPayment(id, { refId }) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const booking = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
    if (!booking) { db.exec('COMMIT'); return { booking: null, alreadyProcessed: false }; }

    if (booking.payment_status !== 'pending') {
      db.exec('COMMIT');
      return { booking, alreadyProcessed: true };
    }

    const upd = db.prepare(
      `UPDATE tour_dates SET seats_taken = seats_taken + ?
       WHERE id = ? AND capacity - seats_taken >= ? AND closed = 0`
    ).run(booking.guests, booking.tour_date_id, booking.guests);

    if (upd.changes === 0) {
      db.prepare(
        `UPDATE bookings SET payment_status = 'paid_no_capacity', zarinpal_ref_id = ?, paid_at = datetime('now') WHERE id = ?`
      ).run(refId, id);
    } else {
      db.prepare(
        `UPDATE bookings SET payment_status = 'paid', status = 'confirmed', zarinpal_ref_id = ?, paid_at = datetime('now') WHERE id = ?`
      ).run(refId, id);
    }

    db.exec('COMMIT');
    return { booking: db.prepare('SELECT * FROM bookings WHERE id = ?').get(id), alreadyProcessed: false };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * A user's bookings, each flagged upcoming or past.
 *
 * tour_dates.label is free-text Persian display copy ("۱۲ مهر") with no
 * machine-readable date anywhere in the schema, so a real chronological split
 * is not possible -- the same limitation getHostBySlug documents. `upcoming`
 * therefore means what it can honestly mean here: the booking is not
 * cancelled, its tour is still publicly visible, and its date is still open.
 */
export function getUserBookings(userId) {
  return db.prepare(
    `SELECT b.ref, b.guests, b.total, b.status, b.created_at AS createdAt,
            t.id AS tourId, t.name AS tourTitle, t.tags, t.status AS tourStatus,
            d.label AS dateLabel, d.closed, d.capacity, d.seats_taken AS seatsTaken
     FROM bookings b
     JOIN tours t ON t.id = b.tour_id
     JOIN tour_dates d ON d.id = b.tour_date_id
     WHERE b.user_id = ?
     ORDER BY b.created_at DESC`
  ).all(userId).map((b) => {
    const { closed, capacity, seatsTaken, tourStatus, ...row } = b;
    const stillVisible = tourStatus === 'published' || tourStatus === 'coming_soon';
    return { ...row, upcoming: row.status !== 'cancelled' && stillVisible && !closed };
  });
}

export function listBookingsAdmin({ paymentStatus, limit } = {}) {
  const clauses = ['1=1'];
  const params = [];
  if (paymentStatus) { clauses.push('b.payment_status = ?'); params.push(paymentStatus); }
  const cappedLimit = Math.min(Number(limit) || 50, 500);
  params.push(cappedLimit);
  return db.prepare(
    `SELECT b.id, b.ref, b.guests, b.total, b.status, b.payment_status AS paymentStatus,
            b.zarinpal_ref_id AS zarinpalRefId, b.created_at AS createdAt,
            t.id AS tourId, t.name AS tourTitle, d.label AS dateLabel,
            u.id AS userId, u.first_name AS firstName, u.last_name AS lastName, u.phone
     FROM bookings b
     JOIN tours t ON t.id = b.tour_id
     JOIN tour_dates d ON d.id = b.tour_date_id
     JOIN users u ON u.id = b.user_id
     WHERE ${clauses.join(' AND ')}
     ORDER BY b.created_at DESC
     LIMIT ?`
  ).all(...params);
}

export function setBookingStatus(id, status) {
  db.prepare(`UPDATE bookings SET status = ? WHERE id = ?`).run(status, id);
  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
}

// --- reviews ------------------------------------------------------------

export function createReview({ tourId, userId, displayName, rating, body }) {
  const info = db.prepare(
    `INSERT INTO reviews (tour_id, user_id, display_name, rating, body, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`
  ).run(tourId, userId, displayName, rating, body);
  return db.prepare('SELECT * FROM reviews WHERE id = ?').get(Number(info.lastInsertRowid));
}

export function listReviewsAdmin(status) {
  const query = status
    ? db.prepare('SELECT * FROM reviews WHERE status = ? ORDER BY created_at DESC')
    : db.prepare('SELECT * FROM reviews ORDER BY created_at DESC');
  return status ? query.all(status) : query.all();
}

export function setReviewStatus(id, status) {
  db.prepare('UPDATE reviews SET status = ? WHERE id = ?').run(status, id);
  return db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
}

export function deleteReview(id) {
  const existing = db.prepare('SELECT * FROM reviews WHERE id = ?').get(id);
  if (!existing) return null;
  db.prepare('DELETE FROM reviews WHERE id = ?').run(id);
  return existing;
}

// --- users ----------------------------------------------------------------

/** Updates the signed-in user's own name. Phone and username are not editable here. */
export function updateUserName(userId, { firstName, lastName }) {
  const info = db.prepare('UPDATE users SET first_name = ?, last_name = ? WHERE id = ?')
    .run(firstName, lastName, userId);
  if (!info.changes) return null;
  const u = db.prepare('SELECT id, phone, first_name, last_name, username, status FROM users WHERE id = ?').get(userId);
  return { id: u.id, phone: u.phone, firstName: u.first_name, lastName: u.last_name, username: u.username, status: u.status };
}

/** The reviews this account has written, with the tour they belong to. */
export function listUserReviews(userId) {
  return db.prepare(
    `SELECT r.id, r.rating, r.body, r.status, r.created_at AS createdAt, t.name AS tourTitle, t.id AS tourId
     FROM reviews r JOIN tours t ON t.id = r.tour_id
     WHERE r.user_id = ? ORDER BY r.created_at DESC`
  ).all(userId);
}

export function listUsersAdmin() {
  return db.prepare(
    'SELECT id, phone, first_name AS firstName, last_name AS lastName, username, status, created_at AS createdAt FROM users ORDER BY created_at DESC'
  ).all();
}

// --- hosts (organizers) ---------------------------------------------------

// The only host shape that ever reaches a public response. contact_phone and
// user_id are internal and are deliberately absent; `verified` is exposed as
// a boolean so the timestamp itself stays internal too.
/**
 * Rounds a coordinate to ~1 km before it leaves the server.
 *
 * A place is very often someone's home. The exact pin is useful to an admin
 * (and to a guest who has already booked, later), but publishing it on an
 * open page hands a street address to anyone who asks the API. Two decimals
 * is enough to put the map on the right valley and not enough to find the
 * front door.
 */
export function approxCoord(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  return Math.round(Number(value) * 100) / 100;
}

function parseAmenities(raw) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function publicHostFields(h) {
  const base = {
    slug: h.slug,
    kind: h.kind === 'place' ? 'place' : 'person',
    displayName: h.display_name,
    photoPath: h.photo_path,
    expertise: h.expertise,
    verified: !!h.verified_at
  };
  // A person has no region, no amenities and no coordinates, so those keys
  // are absent rather than null -- there is nothing for them to mean.
  if (base.kind !== 'place') return base;
  const lat = approxCoord(h.latitude);
  const lng = approxCoord(h.longitude);
  return {
    ...base,
    region: h.region,
    lodgingType: h.lodging_type,
    amenities: parseAmenities(h.amenities),
    // Deliberately named "approximate": the only coordinates that ever cross
    // this boundary are the rounded ones, and the shape says so.
    approximateLocation: (lat == null || lng == null) ? null : { lat, lng }
  };
}

function adminHostFields(h) {
  return {
    id: h.id,
    slug: h.slug,
    kind: h.kind === 'place' ? 'place' : 'person',
    displayName: h.display_name,
    photoPath: h.photo_path,
    bio: h.bio,
    expertise: h.expertise,
    instagramHandle: h.instagram_handle,
    contactPhone: h.contact_phone,
    userId: h.user_id,
    owner: h.user_id ? ownerSummary(h.user_id) : null,
    region: h.region,
    lodgingType: h.lodging_type,
    amenities: parseAmenities(h.amenities),
    latitude: h.latitude,
    longitude: h.longitude,
    media: hostMedia(h.id),
    status: h.status,
    verified: !!h.verified_at,
    verifiedAt: h.verified_at,
    createdAt: h.created_at,
    updatedAt: h.updated_at
  };
}

/** Admin-only: who owns this profile. Never reaches a public response. */
function ownerSummary(userId) {
  const u = db.prepare('SELECT id, phone, first_name, last_name FROM users WHERE id = ?').get(userId);
  if (!u) return null;
  return { id: u.id, phone: u.phone, firstName: u.first_name, lastName: u.last_name };
}

export function hostMedia(hostId) {
  return db.prepare(
    'SELECT id, path AS photoPath, caption, sort_order AS sortOrder FROM host_media WHERE host_id = ? ORDER BY sort_order, id'
  ).all(hostId);
}

/**
 * Replaces a profile's whole gallery in one transaction -- same replace-all
 * contract as setTourHosts, for the same reason: the admin edits a list and
 * saves it once, and a half-written gallery must never be visible.
 *
 * Files whose rows disappear are unlinked only when nothing else references
 * them (another gallery row, or any profile photo), so re-adding the same
 * image elsewhere can never delete it out from under that other use.
 */
export function setHostMedia(hostId, items, deleteFile) {
  const before = db.prepare('SELECT path FROM host_media WHERE host_id = ?').all(hostId).map((r) => r.path);
  const ins = db.prepare('INSERT INTO host_media (host_id, path, caption, sort_order) VALUES (?, ?, ?, ?)');
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM host_media WHERE host_id = ?').run(hostId);
    items.forEach((it, i) => ins.run(hostId, it.photoPath, it.caption || null, i));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  if (typeof deleteFile === 'function') {
    const kept = new Set(items.map((it) => it.photoPath));
    for (const path of before) {
      if (kept.has(path)) continue;
      const stillUsed = db.prepare('SELECT 1 FROM host_media WHERE path = ?').get(path)
        || db.prepare('SELECT 1 FROM hosts WHERE photo_path = ?').get(path);
      if (!stillUsed) deleteFile(path);
    }
  }
  return hostMedia(hostId);
}

/**
 * Active partners for a tour: the venue first, then the lead, then co-hosts.
 *
 * The frontend splits this one array into "محل برگزاری" and "برگزارکنندگان"
 * by role, so the order here is the order those two blocks read in.
 */
export function tourHostsPublic(tourId) {
  return db.prepare(
    `SELECT h.*, th.role FROM tour_hosts th
     JOIN hosts h ON h.id = th.host_id
     WHERE th.tour_id = ? AND h.status = 'active'
     ORDER BY CASE th.role WHEN 'venue' THEN 0 WHEN 'lead' THEN 1 ELSE 2 END, th.sort_order, h.id`
  ).all(tourId).map((h) => ({ ...publicHostFields(h), role: h.role }));
}

/**
 * Public host profile, or null when the slug doesn't exist or isn't active.
 *
 * Tours are split upcoming/past on bookability, not on a calendar date:
 * tour_dates.label is free-text Persian display copy ("۱۲ مهر") with no
 * machine-readable date anywhere in the schema, so a real chronological
 * split isn't possible yet. A tour counts as upcoming while it is publicly
 * visible and still has at least one open date; everything else the host is
 * linked to shows as past.
 */
export function getHostBySlug(slug) {
  const h = db.prepare(`SELECT * FROM hosts WHERE slug = ? AND status = 'active'`).get(slug);
  if (!h) return null;

  const linked = db.prepare(
    `SELECT t.*, th.role FROM tour_hosts th
     JOIN tours t ON t.id = th.tour_id
     WHERE th.host_id = ?
     ORDER BY t.ordinal`
  ).all(h.id);

  const upcoming = [];
  const past = [];
  for (const t of linked) {
    const publiclyVisible = t.status === 'published' || t.status === 'coming_soon';
    const dates = t.status === 'published' ? tourDates(t.id) : [];
    const bookable = dates.some((d) => !d.disabled);
    // Same key names as the cards in listTours(), so the frontend renders a
    // host's tours with the card it already has instead of a parallel shape.
    const entry = {
      id: t.id,
      name: t.name,
      tags: t.tags,
      duration: t.duration,
      comingSoon: t.status === 'coming_soon',
      photoPath: t.photo_path,
      status: t.status,
      priceLine: formatPriceLine(t.price),
      date: (t.day_label && t.month_label) ? { day: t.day_label, month: t.month_label } : null,
      dates: dates.map((d) => ({ label: d.label, status: d.status, disabled: d.disabled }))
    };
    if (publiclyVisible && (bookable || t.status === 'coming_soon')) upcoming.push(entry);
    else if (publiclyVisible) past.push(entry);
  }

  // Only genuine, published customer reviews count. user_id IS NOT NULL is
  // defence in depth: seeded rows (the fabricated ones removed in d0b158c)
  // had no user, and nothing that isn't tied to a real account should ever
  // be presented as social proof for an organizer.
  const reviews = db.prepare(
    `SELECT r.display_name AS displayName, r.rating, r.body, r.created_at AS createdAt, t.name AS tourTitle
     FROM reviews r
     JOIN tour_hosts th ON th.tour_id = r.tour_id
     JOIN tours t ON t.id = r.tour_id
     WHERE th.host_id = ? AND r.status = 'published' AND r.user_id IS NOT NULL
     ORDER BY r.created_at DESC LIMIT 50`
  ).all(h.id);

  const summary = db.prepare(
    `SELECT COUNT(*) AS count, AVG(r.rating) AS average
     FROM reviews r
     JOIN tour_hosts th ON th.tour_id = r.tour_id
     WHERE th.host_id = ? AND r.status = 'published' AND r.user_id IS NOT NULL`
  ).get(h.id);

  return {
    ...publicHostFields(h),
    bio: h.bio,
    instagramHandle: h.instagram_handle,
    // Every gallery path was validated against the /images/... shape before
    // it was stored, so these are safe to put straight into an <img src>.
    gallery: hostMedia(h.id).map((m) => ({ photoPath: m.photoPath, caption: m.caption })),
    tours: { upcoming, past },
    reviews,
    reviewSummary: {
      count: summary.count,
      average: summary.count ? Math.round(summary.average * 10) / 10 : null
    }
  };
}

export function hostSlugExists(slug) {
  return !!db.prepare('SELECT 1 FROM hosts WHERE slug = ?').get(slug);
}

export function listHostsAdmin() {
  return db.prepare('SELECT * FROM hosts ORDER BY display_name').all().map(adminHostFields);
}

export function getHostAdmin(id) {
  const h = db.prepare('SELECT * FROM hosts WHERE id = ?').get(id);
  return h ? adminHostFields(h) : null;
}

export function createHost(v) {
  const info = db.prepare(
    `INSERT INTO hosts (slug, kind, display_name, photo_path, bio, expertise, instagram_handle, contact_phone,
                        user_id, region, lodging_type, amenities, latitude, longitude, status, verified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(v.slug, v.kind || 'person', v.displayName, v.photoPath, v.bio, v.expertise, v.instagramHandle,
    v.contactPhone, v.userId ?? null, v.region ?? null, v.lodgingType ?? null,
    v.amenities ? JSON.stringify(v.amenities) : null, v.latitude ?? null, v.longitude ?? null,
    v.status || 'hidden', v.verified ? new Date().toISOString() : null);
  return getHostAdmin(Number(info.lastInsertRowid));
}

export function updateHost(id, v) {
  const existing = db.prepare('SELECT * FROM hosts WHERE id = ?').get(id);
  if (!existing) return null;
  // Toggling `verified` on stamps the time it was granted; toggling it off
  // clears it. An already-verified host keeps its original timestamp.
  const verifiedAt = v.verified ? (existing.verified_at || new Date().toISOString()) : null;
  // `kind` is not in this list on purpose: it is fixed at create time, like
  // the slug. Flipping a live person profile into a place (or back) would
  // strand whichever set of fields the other kind does not use, and would
  // silently change what a tour that links to it is claiming.
  db.prepare(
    `UPDATE hosts SET display_name = ?, photo_path = ?, bio = ?, expertise = ?, instagram_handle = ?,
       contact_phone = ?, region = ?, lodging_type = ?, amenities = ?, latitude = ?, longitude = ?,
       status = ?, verified_at = ?, updated_at = datetime('now')
     WHERE id = ?`
  ).run(v.displayName, v.photoPath, v.bio, v.expertise, v.instagramHandle, v.contactPhone,
    v.region ?? null, v.lodgingType ?? null, v.amenities ? JSON.stringify(v.amenities) : null,
    v.latitude ?? null, v.longitude ?? null, v.status, verifiedAt, id);
  return getHostAdmin(id);
}

/** Replaces a tour's whole host list in one transaction. */
export function setTourHosts(tourId, entries) {
  const del = db.prepare('DELETE FROM tour_hosts WHERE tour_id = ?');
  const ins = db.prepare('INSERT INTO tour_hosts (tour_id, host_id, role, sort_order) VALUES (?, ?, ?, ?)');
  db.exec('BEGIN');
  try {
    del.run(tourId);
    entries.forEach((e, i) => ins.run(tourId, e.hostId, e.role, e.sortOrder ?? i));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return tourHostsAdmin(tourId);
}

/** kind + status for a set of host ids, keyed by id — used to police tour_hosts roles. */
export function hostKindsById(ids) {
  const out = new Map();
  const get = db.prepare('SELECT id, kind, status FROM hosts WHERE id = ?');
  for (const id of ids) {
    const row = get.get(id);
    if (row) out.set(id, { kind: row.kind === 'place' ? 'place' : 'person', status: row.status });
  }
  return out;
}

export function tourHostsAdmin(tourId) {
  return db.prepare(
    `SELECT h.id AS hostId, h.slug, h.display_name AS displayName, h.kind, h.status,
            th.role, th.sort_order AS sortOrder
     FROM tour_hosts th JOIN hosts h ON h.id = th.host_id
     WHERE th.tour_id = ?
     ORDER BY CASE th.role WHEN 'venue' THEN 0 WHEN 'lead' THEN 1 ELSE 2 END, th.sort_order, h.id`
  ).all(tourId);
}

// --- host applications ----------------------------------------------------

/** How many applications this account still has waiting for a decision. */
export function pendingApplicationCount(userId) {
  return db.prepare(
    `SELECT COUNT(*) AS n FROM host_applications WHERE user_id = ? AND status = 'pending'`
  ).get(userId).n;
}

export function createHostApplication(v, ipHash) {
  const info = db.prepare(
    `INSERT INTO host_applications (user_id, kind, full_name, instagram_handle, expertise,
                                    region, lodging_type, description, ip_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(v.userId, v.kind, v.fullName, v.instagramHandle, v.expertise ?? null,
    v.region ?? null, v.lodgingType ?? null, v.description, ipHash);
  return Number(info.lastInsertRowid);
}

// Admin view of an application. The applicant's name and phone are read from
// their account rather than stored on the row, so a user who corrects their
// phone number does not leave a stale one in the admin queue.
function applicationFields(a) {
  const owner = a.user_id ? ownerSummary(a.user_id) : null;
  return {
    id: a.id,
    kind: a.kind === 'place' ? 'place' : 'person',
    fullName: a.full_name,
    userId: a.user_id,
    applicant: owner,
    // Legacy rows (submitted before accounts were required) carry their own
    // phone; new ones take it from the account.
    phone: owner ? owner.phone : a.phone,
    instagramHandle: a.instagram_handle,
    expertise: a.expertise,
    region: a.region,
    lodgingType: a.lodging_type,
    description: a.description,
    status: a.status,
    adminNote: a.admin_note,
    hostId: a.host_id,
    createdAt: a.created_at,
    reviewedAt: a.reviewed_at
  };
}

// --- the signed-in user's own partner data --------------------------------
//
// Both of these take the user id from the session and nothing else: there is
// no route that accepts a user id from the client, so one account can never
// read another's applications or profiles.

/** What this account has applied for. Internal admin notes are not included. */
export function listUserApplications(userId) {
  return db.prepare(
    'SELECT * FROM host_applications WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId).map((a) => ({
    id: a.id,
    kind: a.kind === 'place' ? 'place' : 'person',
    name: a.full_name,
    status: a.status,
    createdAt: a.created_at,
    reviewedAt: a.reviewed_at
  }));
}

/** The profiles this account owns. A hidden one has no public URL yet. */
export function listUserProfiles(userId) {
  return db.prepare(
    'SELECT * FROM hosts WHERE user_id = ? ORDER BY created_at DESC'
  ).all(userId).map((h) => ({
    slug: h.slug,
    kind: h.kind === 'place' ? 'place' : 'person',
    displayName: h.display_name,
    status: h.status,
    verified: !!h.verified_at,
    photoPath: h.photo_path
  }));
}

export function listHostApplications(status) {
  const rows = status
    ? db.prepare('SELECT * FROM host_applications WHERE status = ? ORDER BY created_at DESC').all(status)
    : db.prepare(
      `SELECT * FROM host_applications
       ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at DESC`
    ).all();
  return rows.map(applicationFields);
}

export function getHostApplication(id) {
  const a = db.prepare('SELECT * FROM host_applications WHERE id = ?').get(id);
  return a ? applicationFields(a) : null;
}

/**
 * Approves an application: creates the hosts row (hidden, prefilled from what
 * was submitted) and links it back, in one transaction. The admin completes
 * the profile and flips it to active afterwards.
 */
export function approveHostApplication(id, slug) {
  db.exec('BEGIN');
  try {
    const a = db.prepare(`SELECT * FROM host_applications WHERE id = ? AND status = 'pending'`).get(id);
    if (!a) { db.exec('ROLLBACK'); return { ok: false, error: 'not_pending' }; }
    if (db.prepare('SELECT 1 FROM hosts WHERE slug = ?').get(slug)) {
      db.exec('ROLLBACK');
      return { ok: false, error: 'slug_taken' };
    }
    // The new profile is owned by the account that applied, and its contact
    // phone comes from that account -- not from anything typed into the form.
    const owner = a.user_id
      ? db.prepare('SELECT phone FROM users WHERE id = ?').get(a.user_id)
      : null;
    const info = db.prepare(
      `INSERT INTO hosts (slug, kind, display_name, expertise, instagram_handle, contact_phone,
                          user_id, region, lodging_type, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'hidden')`
    ).run(slug, a.kind || 'person', a.full_name, a.expertise, a.instagram_handle,
      owner ? owner.phone : a.phone, a.user_id, a.region, a.lodging_type);
    const hostId = Number(info.lastInsertRowid);
    db.prepare(
      `UPDATE host_applications SET status = 'approved', host_id = ?, reviewed_at = datetime('now') WHERE id = ?`
    ).run(hostId, id);
    db.exec('COMMIT');
    return { ok: true, hostId };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function rejectHostApplication(id, adminNote) {
  const a = db.prepare(`SELECT * FROM host_applications WHERE id = ? AND status = 'pending'`).get(id);
  if (!a) return null;
  db.prepare(
    `UPDATE host_applications SET status = 'rejected', admin_note = ?, reviewed_at = datetime('now') WHERE id = ?`
  ).run(adminNote || null, id);
  return getHostApplication(id);
}
