# chaacme-platform — backend

A zero-dependency Node API for the booking platform designed in
[`Chaacme design system refinement/`](./Chaacme%20design%20system%20refinement)
(Home, Experiences, TourDetail, Booking, Login, Account, …). Those `.dc.html`
files are Claude Design canvas *source* — a design-tool preview, not a
deployable frontend — so this backend is not paired with a `public/`
directory yet. It's a plain JSON API that whatever frontend gets built from
those designs (or the canvas pages themselves, once exported) can call.

Modeled on the conventions already established in `../chaacme/site`: no
framework, no build step, `node:sqlite`, fail-fast on missing secrets rather
than insecure defaults, DB-persisted rate limiting, security headers.

## Run it

```bash
npm install    # no-op — there are no dependencies
IP_HASH_SALT="$(openssl rand -base64 32)" \
OTP_PEPPER="$(openssl rand -base64 32)" \
ADMIN_TOKEN="$(openssl rand -hex 32)" \
npm run dev
```

`npm run smoke` boots the server on a temp DB and exercises the whole surface
(catalog, OTP login, bookings with real capacity enforcement, review
moderation, admin CRUD, rate limits) — run it after any change to `server/`.

`npm run reseed` re-applies `server/content.seed.json` (ported from the
frontend's `helpers/chaacme-data.js` mock) over an existing database.

## What's not real yet

- **OTP delivery.** No SMS vendor is integrated (none was specified). Dev
  mode logs codes to the console; production refuses to boot without
  `SMS_WEBHOOK_URL` configured. See `deploy/env.example`.
- **Payment.** ZarinPal is wired up, sandbox-mode by default (`ZARINPAL_SANDBOX`,
  see `deploy/env.example`). `POST /api/bookings` no longer reserves a seat —
  it only records the booking as `pending_payment`/`payment_status:'pending'`;
  a seat is reserved atomically only once `GET /api/payments/zarinpal/callback`
  confirms payment (`server/db.js`'s `confirmBookingPayment`). If capacity ran
  out between request and verification, the booking lands in
  `payment_status:'paid_no_capacity'` instead of being oversold — flagged for
  manual follow-up, no refund flow built yet.
- **Real photos exist now, but nothing's uploaded yet.** `POST
  /api/admin/upload` accepts a real image and stores its path; `tours.photo_path`
  (card thumbnail), `tour_media.image_path` (gallery photos) and
  `tour_itinerary.photo_path` (itinerary step photos) all exist and round-trip
  through the admin/public APIs — but every seeded tour still ships with only
  text labels (`gallery`, `photoLabel`, no `photoPath`/`galleryPhotos`) until
  an admin uploads real images and PUTs the returned paths onto a tour.

## How each frontend flow maps to the API

**Home / Experiences** (`TOURS` list, search/filter is client-side)
- `GET /api/tours` → `{ tours: [{ id, name, tags, duration, price, featured, comingSoon, availability, nextDate, review }] }`

**TourDetail** (gallery, highlights, itinerary, reviews, booking dates)
- `GET /api/tours/:id` → full detail incl. `photoPath`, `priceLine` (Farsi-formatted, derived from `price` — never stored separately), `date` (`{day, month}` curated card copy, independent of `bookingDates`), `gallery`/`galleryPhotos` (parallel label/path arrays), `highlights` (`{name, description}`), `itinerary` (`{time, title, description, photoLabel, photoPath}`), and `bookingDates` (id/label/status/disabled/available, computed live from capacity — never stale copy)
- `POST /api/tours/:id/reviews` `{ rating, body }` — auth required; goes in as `pending` until moderated

**Login** (phone → OTP → profile-if-new → session)
- `POST /api/auth/otp/request` `{ phone }` → `{ expiresInSeconds }`
- `POST /api/auth/otp/verify` `{ phone, code }` → existing user: sets session cookie, `{ status:'existing', user }`; new number: `{ status:'new', ticket, expiresInSeconds }`
- `POST /api/auth/profile` `{ ticket, firstName, lastName, username }` → creates the account, sets session cookie
- `GET /api/auth/me` / `POST /api/auth/logout`

Session is an `HttpOnly` cookie (`chaacme_session`); non-browser clients may
send `Authorization: Bearer <token>` instead — same token.

**Booking** (date → guests → pay via ZarinPal → done)
- `POST /api/bookings` `{ tourId, tourDateId, guests }` — auth required; soft-checks capacity (a UX check only — the seat isn't held) and records a `pending_payment`/`pending` booking, returns `{ booking: { id, ref, total, status } }`. `409 not_enough_seats` if the date already looked full.
- `POST /api/payments/zarinpal/request` `{ bookingId }` — auth required, booking must belong to the caller and still be `payment_status:'pending'`; returns `{ redirectUrl }` to send the browser to (`window.location.href = redirectUrl`). Amount is derived from the booking's stored `total` (Toman), converted to Rial only in the ZarinPal payload.
- `GET /api/payments/zarinpal/callback?Authority=...&Status=...` — ZarinPal redirects the user's browser here. Verifies payment, atomically reserves the seat (or sets `paid_no_capacity` if it ran out in the meantime), then 302s to `${FRONTEND_ORIGIN}/booking/result?status=success|failed|no_capacity|error&ref=...`. Idempotent — safe to hit twice for the same authority.

**Account** (profile + booked tours)
- `GET /api/auth/me`, `GET /api/bookings/me`

**Contact / About** — static content in the designs; nothing dynamic to back.

## Admin

Real login, not a shared secret: `POST /api/admin/login {username, password}`
sets an `HttpOnly` `chaacme_admin_session` cookie (12h TTL) that every
`/api/admin/*` route below requires. `POST /api/admin/logout` revokes it.
Passwords are salted+hashed with `scrypt` (`server/adminAuth.js`), never
stored in plaintext, and never in an env var. There's a single admin account
by design (no roles) — create or reset it on the host with:

```bash
npm run admin:set-password -- <username> <password>
```

This is a completely separate system from the phone/OTP end-user login
(`server/auth.js`, `chaacme_session` cookie) — different tables
(`admin_users`/`admin_sessions` vs `users`/`sessions`), different cookie
name, no shared code path.

| | |
|---|---|
| `POST /api/admin/login`, `POST /api/admin/logout`, `GET /api/admin/me` | session lifecycle |
| `GET/POST /api/admin/tours`, `GET/PUT/DELETE /api/admin/tours/:id` | catalog CRUD (draft → published → archived); GET/POST/PUT accept and return `photoPath`/`priceLine`/`date`/`gallery`+`galleryPhotos`+`galleryMedia`/`highlights`/`itinerary`/`reviewCategories` alongside the flat tour fields. `POST` requires a manually-chosen `id` (lowercase letters/digits/hyphens, e.g. `desert-parthian`) — `422` if malformed, `409` if already taken. `DELETE` is `409` if the tour has real bookings (archive it instead) |
| `DELETE /api/admin/tours/:id/gallery/:mediaId` | remove one gallery photo (by the `id` in `galleryMedia`) and unlink its file from disk |
| `PUT /api/admin/tours/:id/gallery/reorder {order:[mediaId,...]}` | reorder gallery photos; `order` must be an exact permutation of that tour's existing `galleryMedia` ids |
| `POST /api/admin/tours/:id/dates`, `PUT /api/admin/tour-dates/:id` | add a bookable date, change capacity/close it |
| `POST /api/admin/upload` | `multipart/form-data`, field `file` (jpg/png/webp, sniffed from bytes — not trusted from the client — 5MB max) + optional `tourId`; saves under `FRONTEND_STATIC_DIR/tour-<id>/` (falls back to `.../uploads/` without a valid `tourId`) and returns `{ path }` to PUT onto a tour |
| `GET /api/admin/reviews?status=pending`, `PUT /api/admin/reviews/:id` | moderation queue, approve/reject |
| `GET /api/admin/bookings?payment_status=&limit=`, `PUT /api/admin/bookings/:id` | list (newest-first, default limit 50, max 500; `payment_status` filters to `pending`/`paid`/`failed`/`canceled`/`paid_no_capacity`), confirm/cancel |
| `GET /api/admin/users` | list accounts |

`POST`/`PUT` on `/api/admin/tours[/:id]` replace-all the `highlights`/
`itinerary`/`gallery` (+`galleryPhotos`)/`reviewCategories` arrays when that
key is present in the body (omit the key to leave existing rows untouched) —
same all-or-nothing semantics `seed()` has always used, just scoped to one
tour. `tour_dates` is deliberately excluded from this — it carries live
capacity state and FK'd bookings, so dates stay managed one at a time via the
dedicated endpoints above. Reordering gallery photos can also be done by
PUT-ing a reordered `gallery`/`galleryPhotos` pair through this same
replace-all path; the dedicated `/gallery/reorder` endpoint exists so the
admin UI can reorder without resending every other field.

A vanilla-JS admin panel (login, tour list, create/edit form, gallery
manager, bookings/payments list) is served as a static page at `/admin` — it
lives in the frontend's own static tree
(`/srv/chaacme-platform/frontend/admin/index.html` in production), not
alongside this backend's own routes, since this backend ships no `public/`
dir (see "What's not real yet" above). Its source is tracked here as
[`deploy/admin-index.html`](./deploy/admin-index.html) purely so changes to
it are diffable in git — deploying it means copying that file to the path
above, the same way `deploy/chaacme-platform.service` documents (but doesn't
itself deploy) the systemd unit.

## Schema

`server/db.js` has the full picture; short version:

- `tours`, `tour_media`, `tour_highlights`, `tour_itinerary`, `tour_review_categories`, `tour_dates` — catalog
- `users`, `otp_codes`, `signup_tickets`, `sessions` — phone/OTP auth (OTP codes and session tokens are stored hashed, never in plaintext)
- `admin_users`, `admin_sessions` — admin login (password hashed with `scrypt`, session tokens hashed like `sessions`) — entirely separate from the tables above
- `bookings`, `reviews`, `rate_limit`

No separate migration runner exists — new columns are added the same way the
tables themselves are bootstrapped: idempotent DDL that runs on every boot
(`CREATE TABLE IF NOT EXISTS` for tables, an `ensureColumn()` helper guarded
by `PRAGMA table_info` for columns added to an already-existing table). Never
hand-edit the live `.db` file; add a new `ensureColumn(...)` call in `db.js`
instead.
