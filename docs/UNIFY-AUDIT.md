# Unify-site audit (written before the work, kept as the record of what changed)

Pre-check: `origin/main` contains phase 1 (server-rendered `/tour/<slug>`, `deploy/assets/chaacme.css`,
`deploy/assets/js/shared/{html.js,components/}`, `server/render.js`, the image-variant pipeline in
`server/images.js`, migration 003). The shared modules live under `deploy/assets/js/shared/` (served as
`/assets/js/shared/`), not a top-level `shared/` directory.

## 1. Every route / screen today and where it goes

| URL | Today | After this PR | Rendering |
|---|---|---|---|
| `/` | old SPA home (hero video, ticket strip, English sections) | **home** template (04) | server, cached 60 s |
| `/experiences` | not a URL (SPA state `page-experiences`) | **experiences** template (05) + GET filters | server, cached 60 s |
| `/places` | does not exist (not in nav) | **places index** (same cards as home) | server |
| `/tour/<slug>` | server-rendered (phase 1), SPA shell as fallback | unchanged template; on a render error the generic **error page** (the SPA fallback is removed) | server |
| `/host/<slug>` | SPA `page-host`, one layout for both kinds | **place profile** (03) or **person profile**, branched on `kind` | server |
| `/about` `/terms` `/refund` `/privacy` | `about` was an SPA state with English copy; the others do not exist | **info page** template; body from site settings; empty content = 404 and no footer link | server |
| `/contact` | SPA state with a placeholder e-mail ("Replace the email above…") | **removed**: no data source, placeholder content. Contact details belong in the `/about` body. Answers the 404 page | – |
| `/login`, `/signup` | SPA states (no URL for signup) | client screens in the new styling; OTP/password toggle kept (OTP tab stays hidden while `OTP_LOGIN_DISABLED`) | shell by server + client |
| `/account` | SPA state | client screen (07) | shell + client |
| `/become-host` | SPA route | client screen (06); same validation, honeypot and rate limits | shell + client |
| `/partner`, `/partner/profile/<slug>`, `/partner/experiences`, `/partner/propose` | SPA routes | client screens (08) | shell + client |
| `/booking/result` | SPA state with a hard-coded tour name | client screen; loads the signed-in user's own booking by `ref` | shell + client |
| `/admin` (hash routes `#/tours`, `#/tours/<id>/edit`, `#/hosts…`, `#/applications`, `#/revisions`, `#/proposals`, `#/bookings`) | static `admin-index.html`, old stylesheet | same file and same routes, restyled on `chaacme.css`; new `#/settings` | static + client |
| any other path | SPA redirected unknown paths to `/` | the 404 page (status 404) | server |
| old SPA tour URLs (`/tours/<slug>`, `/experiences/<slug>`) | n/a / SPA | 301 → `/tour/<slug>` | server |

Nothing is left on the old styling. The only thing that cannot be converted is `/contact` (above).

## 2. Data per page: existing field | MISSING

| Page | Needs | Status |
|---|---|---|
| Home | hero video / poster / fallback image, headline, subline, 2 CTA labels | **MISSING** → `site_settings` |
| | upcoming tours (published, open dated edition) | existing (`tours`, `tour_dates.starts_on`) |
| | explainer title/text, 3 cards (title, text, image) | **MISSING** → `site_settings` |
| | places (active place profiles) | existing |
| | become-host band title/text/CTA label | **MISSING** → `site_settings` |
| Experiences | region, experience type, edition month, open-only | existing (`tours.region`, `tours.experience_type`, `tour_dates`) |
| Place profile | name, verified, lodging type, region text, bio, capacity, amenities, house rules, instagram, approx. coords, gallery, main photo | existing (`hosts`, `host_media`) |
| | region stamp (desert/forest/sea) | **MISSING** → `hosts.region_key` |
| | gallery alt text | **MISSING** → `host_media.alt` (caption exists) |
| | number of experiences, linked experiences, reviews | derived from `tour_hosts`, `tours`, `reviews` |
| | "suitable for" fact in the reference | **not built**: no field exists and the owner never entered it; the fact is omitted |
| Person profile | portrait, expertise, credentials, bio, instagram | existing; credentials public only with the new `hosts.credentials_public` (migration 005) |
| Info pages | four bodies | **MISSING** → `site_settings` |
| Footer | links, Instagram handle | **MISSING** → `site_settings` |
| Booking result | booking by ref for its owner (tour title, edition, party size, total, payment status) | existing in `bookings`; **new** owner-only endpoint `GET /api/me/bookings/<ref>` |
| Account | bookings with cover + payment status | `payment_status` and cover were not in `GET /api/bookings/me` → added (additive) |

### Credentials stay private unless the owner opts in
The partner form told owners that «سوابق و گواهینامه‌ها» is seen **only by the chaacme team**, so existing values are not published.
Migration 005 adds `hosts.credentials_public` (default 0 for every existing row). The person profile shows credentials only when it is 1;
the owner turns it on with the checkbox «نمایش عمومی سوابق و گواهینامه‌ها» (a normal pending revision), or an admin sets it.
`house_rules` and `capacity_guests` are public for places (the form never promised secrecy for them). `seeking_place_types` and
`accepts_experience_types` stay private.

## 3. Old code that becomes dead (removed in this PR)
* `deploy/index.html` SPA (≈4 000 lines): pages home / experiences / about / contact / tour / login / signup / account / booking /
  host / become-host / partner / not-found and all its CSS. `deploy/index.html` is **replaced by a tiny static maintenance page** in the new
  design, only because `scripts/deploy-prod.sh` publishes that file and nginx's `error_page 502 503 504 = /index.html` points at it.
* `server/pages.js` `injectTourMeta` / `FRONTEND_INDEX_FILE` shell fallback (it only existed so the SPA could render the tour).
* The old `/tour` safety net in `nginx-tour.conf.example` is replaced by the new location list.
* Old stylesheet (inline in both HTML files) – gone; only `chaacme.css` remains.
* `test/redirect.test.js` read the `next` rule out of the SPA source; the rule now lives in `shared/next.js` and is tested directly.
