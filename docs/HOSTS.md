# Partner profiles (people and places)

Chaacme builds a tour out of two things: the **people** who run it and the
**place** it happens in. Both are partner profiles, both live at
`/host/<slug>`, and both are applied for — while signed in — through
`/become-host`. Chaacme is the curator that connects them, which is what the
"طراحی و هماهنگی: چکمه" line on a tour page says out loud.

- **person** — a facilitator, guide or coach (an Animal Flow coach, say).
  Described by expertise and a bio.
- **place** — a permanent venue or lodging (an eco-lodge in the Mazandaran
  forests). Described by lodging type, region, amenities, a gallery and an
  approximate location.

One account can be a traveller *and* own several partner profiles. Content is
still admin-curated: an owner can see their profiles on their account page,
but only an admin edits what appears on one.

## Data model

Four tables, created by the idempotent bootstrap in `server/db.js` — no
migration runner, same `CREATE TABLE IF NOT EXISTS` + `ensureColumn()`
convention as the rest of the schema.

- **`hosts`** — the profile. `kind` is `person` or `place` and, like `slug`,
  is **fixed at create time**: the admin PUT reads it from the stored row, not
  from the payload, because the two kinds do not use the same columns and a
  flip would strand whichever set the other kind ignores. `slug` is the public
  URL segment and is likewise immutable (a live profile URL must not rot).
  `status` is `active` or `hidden`, and there is **no hard delete** — hiding is
  how a profile leaves the site, so tour history and inbound links survive.
  `verified_at` is a timestamp, not a boolean, so "when were they verified"
  stays answerable; the public API projects it down to `verified: true|false`.
  - Place-only columns, all nullable and all stripped for a person by
    `validateHostProfile()`: `region`, `lodging_type`, `amenities` (a JSON
    array, max 20 items of max 40 characters), `latitude`, `longitude`.
  - `user_id` is the **owner account**. Nullable (an admin-created profile has
    no owner) and deliberately **not unique** — one account may own several
    profiles — with a plain index for the "my profiles" lookup.
- **`host_media`** — a profile's gallery: `path`, `caption`, `sort_order`,
  cascading on the profile. Mostly a place thing; nothing stops a person using
  it. Paths are validated against the same `/images/...` shape as
  `hosts.photo_path`.
- **`tour_hosts`** — which partners a tour has, with `role`
  (`lead` / `co_host` / `venue`) and `sort_order`. **Role and kind must
  agree**, enforced server-side in `PUT /api/admin/tours/:id/hosts`: a place
  can only be `venue`, a person can never be `venue`, and a tour can have at
  most one venue. Public ordering is venue, then lead, then co-host, then
  `sort_order`, then id.
- **`host_applications`** — an inbound application, now always tied to a
  `user_id`. It carries `kind` and the place fields, and **no phone of its
  own**: the applicant's phone is read from their account, so correcting it
  there corrects it everywhere. Stores `ip_hash` (salted, via the same
  `hashIp()` auth uses), **never a raw IP**. Approving one creates a `hidden`
  profile inside a transaction — prefilled, owned by the applicant's account,
  with `contact_phone` taken from that account — and links the two via
  `host_id`.

`full_name` on an application is the **public profile name being proposed**
(a person's display name, or the place's name), not the applicant's legal
name, which is already on their account.

### Migrating an existing database

SQLite cannot change a `CHECK` that is already part of a table definition, so
`tour_hosts` (role gains `venue`) and `host_applications` (`phone` loses
`NOT NULL`) are rebuilt once by `rebuildTable()` in `server/db.js`, using the
documented 12-step procedure. Each rebuild is guarded by a predicate over the
stored `CREATE` statement, so it runs at most once and every later boot is a
no-op. `hosts` only *gains* columns, and SQLite accepts a `CHECK` on an added
column, so those are plain `ensureColumn()` calls.

One ordering trap worth keeping in mind: the bootstrap `CREATE` block at the
top of `db.js` runs **before** the migrations, so it must never name a column
that only exists after one. `idx_host_applications_user` is created after the
rebuild for exactly this reason.

## Privacy rules

These are enforced at the query layer, not by remembering to strip fields at
each call site.

- `publicHostFields()` in `server/db.js` is the **only** host shape that
  reaches a public response. It emits `slug`, `kind`, `displayName`,
  `photoPath`, `expertise` and the `verified` boolean, plus — for a place only
  — `region`, `lodgingType`, `amenities` and `approximateLocation`.
  `contact_phone`, `user_id`, the internal row id and the raw `verified_at`
  cannot leak through `GET /api/hosts/:slug`, the tour list, or tour detail,
  because none of those responses ever construct a host object any other way.
  A person profile carries no place keys at all — they are absent, not null.
- **A place's exact coordinates are never published.** A place is very often
  someone's home. The admin needs an accurate pin and gets one; the public
  projection rounds through `approxCoord()` to **two decimals (~1 km)** and
  emits it under the name `approximateLocation`, so the shape itself says what
  it is. The frontend draws a bbox *around* that rounded point — an area, not
  a marker — and `scripts/smoke.js` walks whole public payloads at any depth
  asserting that no `lat`/`lng`/`latitude`/`longitude` anywhere carries more
  than two decimals.
- **Applying requires a session.** `POST /api/host-applications` is `401`
  without one. The applicant is whoever the session says they are, so a form
  field can never claim someone else's name or phone. Limits: 3 per day per
  IP hash, 3 per day per user, and at most 3 applications pending per account
  — all answered with the same uniform `{ok: true}` as everything else here.
- **`/api/me/*` is scoped strictly to the session user.**
  `/api/me/applications`, `/api/me/profiles` and `/api/me/reviews` take the id
  from the session and **never accept one from the client**, so there is
  nothing for one account to point at another's data with. The smoke suite
  asserts this directly with a second account.
- `contact_phone` is for the Chaacme team to reach the organizer. It is never
  rendered, and the application form says so in as many words.
- **Instagram is stored as a bare handle**, matching `^[A-Za-z0-9._]{1,30}$`,
  with any `@` or `instagram.com/` prefix stripped on the way in. The frontend
  builds `https://instagram.com/<handle>` itself. No arbitrary URL supplied by
  an applicant is ever stored or rendered, so a profile cannot become a link
  to somewhere else.
- Host review aggregation counts only rows with
  `status = 'published' AND user_id IS NOT NULL`. Defense in depth: even if
  anonymous rows were ever inserted again, they cannot become a host's rating.

## Reviews are never seeded

`seed()` owns the catalog only. It does not insert reviews, and it no longer
deletes them either — the old per-tour `DELETE FROM reviews` would have
destroyed genuine customer reviews on any forced reseed. An empty review list
is an honest empty state ("هنوز نظری ثبت نشده"), not a bug to fill with
invented social proof.

## Upload paths

Host photos go to `/images/host-<slug>/`. The slug is validated against
`HOST_SLUG_RE` **before** it is used to build any path, so `../x`, `a/b` and
`host-../` are rejected outright rather than sanitised. The delete-side guard
`SAFE_UPLOAD_PATH` accepts the slug charset only (lowercase, digits, hyphen),
so a crafted `photo_path` cannot unlink anything outside the images tree.
`scripts/smoke.js` asserts both directions, including a positive control that
proves the guard is not simply refusing everything.

### Partner uploads waiting for review

A partner's own upload is **not** written under `images/`. It goes to
`PENDING_UPLOAD_DIR/host-<slug>/` (default: `pending-uploads/` beside the
database), outside the web root, because nginx serves everything under the web
root straight off disk and an unreviewed image must not be reachable by URL. The
id stored in a revision is still `/images/host-<slug>/pending/<file>` (a logical
id; `validateRevision` and approval work on it unchanged), and the browser sees
the file only through `GET /api/partner/profiles/<slug>/pending/<file>` (owner)
or `GET /api/admin/host-pending/<slug>/<file>` (admin). Approval moves the file to
`images/host-<slug>/`; rejection and withdrawal delete it. See `docs/DEPLOY.md`
for the nginx rule that backs this up.

## Running the smoke suite against a remote host

**Today `scripts/smoke.js` has no remote mode.** It unconditionally creates a
temp directory with `mkdtempSync`, spawns its own `server/index.js` against a
throwaway SQLite file on a fixed `127.0.0.1:3988`, creates its own admin
account, mocks ZarinPal on a local port, and deletes the whole directory with
`rmSync` in its `finally` block. `BASE` is a constant; there is no base-URL
environment variable to point it anywhere else. It is therefore safe to run
today: it cannot touch a real database, because it never talks to one.

Roadmap Step 2's `deploy.sh` will want to run it against a staging or
production URL. **When that remote mode is added, it must obey this split.**

Mutating tests — anything that creates a host, an application, a
`tour_hosts` link, or uploads a host photo — run in **local temp-DB mode
only**. They exist because the temp DB is destroyed wholesale at the end of
the run; there is no hard-delete endpoint for a host, so against a real
database those rows would be permanent, and a fabricated "Smoke Host" would
be exactly the kind of fake profile this feature is supposed to avoid.

In remote mode run only these non-mutating host checks:

1. `GET /api/hosts/<nonexistent-slug>` → `404`.
2. `GET /api/tours/<id>` → `tour.hosts` is an array, and no entry carries
   `contactPhone` or `userId`. This is the leak assertion that actually
   matters in production, and it writes nothing.
3. `POST /api/host-applications` with no session → `401`, and **no row
   written**. The session check is now the first thing the handler does, ahead
   of the honeypot, validation, the rate limiter and any database call, so
   this writes nothing by construction. (The old suggestion here — an
   unauthenticated honeypot POST expecting `201` — is obsolete: applying
   requires an account, so that request is refused before it ever reaches the
   honeypot.) If that ordering ever changes, drop this check from remote mode
   rather than weakening the assertion.
4. `GET /api/me/profiles` with no session → `401`. Same reasoning: it reads
   nothing and writes nothing without a session.

Everything else in the host block stays behind the local-mode guard. The same
reasoning applies to the existing booking, signup and review tests, which
also create real rows — whoever adds remote mode should audit those at the
same time.

## Managing partners in the admin panel

`/admin/` → **Organizers** (the partner-profile list) and **Applications**.

- **Creating a profile.** Two buttons, **+ New person** and **+ New place**,
  because the two kinds have different fields. Kind and slug are both
  **fixed at creation** — both inputs disappear once the profile exists, and
  the slug is the public address `/host/<slug>`. New profiles start `hidden`.
- **A place has its own panels.** *Lodging type* and *Region* sit with the
  rest of the profile (region is required and is shown publicly — keep it to
  an area, never a street address). *Amenities* is a chip list, up to 20 of up
  to 40 characters, saved with the profile. *Location* takes the real
  latitude/longitude: it is kept for you, not published, and the panel says so
  — the public page only ever shows it rounded to ~1 km as a map area. Give
  both coordinates or neither; a half pair is a 422, not a guess.
- **Gallery.** Uploading adds an image immediately; **Save gallery** is what
  stores the list, its order and its captions. It has its own button because
  `PUT /admin/hosts/:id/media` replaces the whole gallery in one transaction,
  so a half-built list must never be sent. Removing an image unlinks the file
  only when nothing else still references it.
- **The list shows kind and owner.** Filter by kind at the top; the *Owner
  account* column names the account a profile belongs to, or "بدون حساب" for
  an admin-created one.
- **Visibility.** `hidden` keeps a profile off the site entirely: its URL
  returns not-found and it disappears from any tour it is linked to.
  `active` publishes it. **There is no delete** — hiding is the way to take a
  profile down, because the URL may already be linked from elsewhere.
- **Verified** shows the "تأییدشده توسط چکمه" badge. It is a claim about a
  real check, so the panel says so next to the checkbox.
- **Contact phone is internal.** It is on the admin form and in the
  application list, and never in any public response.
- **Assigning to a tour:** Tours → edit a tour → **Partners**. Two pickers:
  **محل برگزاری / Venue** (places only, at most one) and
  **برگزارکنندگان / People** (persons only, lead/co-host, ordered). They share
  **one** save button because they are one list behind the scenes —
  `PUT /admin/tours/:id/hosts` replaces it in a single transaction — so
  editing is local until you press it. The first person added defaults to
  `lead`, the rest to `co_host`; the venue renders above the people, leads
  before co-hosts, and the order within a role is the order shown. A linked
  profile that is `hidden` is flagged in its row as not publicly visible.
- **Applications → Approve** creates a **hidden** profile of the kind that was
  applied for, prefilled from the submission, **owned by the applicant's
  account** and carrying that account's phone as its internal contact. It then
  opens the profile, so nothing reaches the site until someone completes it
  and sets it to active. Reject takes an optional internal note that is never
  sent to the applicant.
- **The applicant's account is shown, admin-only.** Each application card
  names the account and its phone. Neither is ever part of a public response.

### Creating a place and putting it on a tour

1. **Organizers → + New place.** Give it a slug (e.g. `dood-lodge`), the place
   name, lodging type and region, then **Create profile**. It is `hidden`.
2. Fill in the rest: description, amenities, latitude/longitude, cover photo,
   and gallery images (**Save gallery** separately).
3. Set **Status → active** and **Save changes**. `/host/<slug>` is now live.
4. **Tours → edit the tour → Partners → محل برگزاری**, choose the place, then
   **Save partners**. The tour page now shows a "محل برگزاری" block above its
   "برگزارکنندگان" block.

## The account page is the private traveller profile

`/admin` has nothing to do with this: an ordinary account's page carries
**اطلاعات من** (first/last name editable through `PUT /api/auth/me`; phone and
username read-only), **سفرهای من** (bookings, split upcoming/past),
**نظرهای من** (their reviews with status) and **همکاری با چکمه** (their
applications and the profiles they own, linking only to the *active* ones —
a hidden profile's URL answers not-found, so handing the owner that link would
be a lie). Nothing on the page is published anywhere.

Owners can currently **view** their profiles there, not edit them. Letting an
owner edit their own profile is a deliberate later step.

## Known follow-ups

- **`tour_dates` has no machine-readable date.** `label` is free Persian text
  ("۱۲ مهر"), so neither a partner profile nor the account page can sort by
  calendar date. Both use the same honest proxy: something counts as upcoming
  while it is publicly visible and still open (or marked `coming_soon`). A
  real split needs an ISO `start_date` column alongside the label, which would
  also let past dates auto-hide.
- **Owners cannot edit their own profiles yet.** `hosts.user_id` now carries
  the owner and `/api/me/profiles` reads it back, so the remaining work is an
  owner-scoped write endpoint and a form — not a schema change.
- **No per-host Open Graph tags.** The SPA serves one static `index.html`, so
  a shared `/host/<slug>` link previews as the site, not the organizer. Needs
  either server-rendered meta tags for that route or a prerender step.
- **No staging environment and no `scripts/deploy.sh`.** `app.chaacme.ir` is a
  retired nginx 301 to the main site, not a staging server. This feature ships
  through the pipeline built in roadmap Step 2, not by hand.
