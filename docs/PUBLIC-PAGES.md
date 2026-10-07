# Pages: server-rendered templates + small client screens

One site, one stylesheet (`deploy/assets/chaacme.css`), one header, one footer, one set of shared components.

* **Public pages** are rendered by the server from shared ES-module templates (`data -> escaped HTML`) with small client
  enhancements. Every one reads without JavaScript.
* **Screens behind login** (`/login`, `/signup`, `/account`, `/become-host`, `/booking/result`, `/partner…`) get a server-rendered shell
  (real header + footer + an empty `#app`); their script fills `#app` with the **same** shared templates through `mount()`.
* **The admin** (`deploy/admin-index.html`, served by nginx at `/admin`) is client-rendered on the same CSS and header component.

## Routes

| URL | Template | View model |
|---|---|---|
| `/` | `shared/pages/home.js` | `GET /api/pages/home` |
| `/experiences?region=&type=&month=&open=1` | `experiences.js` | `GET /api/pages/experiences?…` |
| `/places` | `places.js` | `GET /api/pages/places` |
| `/tour/<slug>` | `tour.js` | `GET /api/pages/tour/<slug>` |
| `/host/<slug>` (place or person) | `host.js` | `GET /api/pages/host/<slug>` |
| `/about /contact /terms /refund /privacy` | `info.js` (404 while the body / contact details are empty; `/contact` is structured: phone, e-mail, address, hours with `tel:`/`mailto:` links) | `GET /api/pages/info/<key>` |
| `/login /signup /account /become-host /booking/result /partner…` | `screen.js` shell + `assets/js/screens/*.js` | `/api/me/*`, `/api/partner/*`, `GET /api/me/bookings/<ref>` |
| anything else | `errors.js` 404 (status 404) | – |
| `/tours/<slug>`, `/experiences/<slug>` | 301 → `/tour/<slug>` | – |

## How a page is built

```
server/pages.js        route table
server/render.js       view model -> HTML, headers, caching, asset URLs + import map
server/pagemodels.js   buildXPage(): the ONE function per page type that builds the (public) view model
server/settings.js     site_settings (home copy, footer, info pages) + siteContext() for the footer
deploy/assets/js/shared/pages/x.js   template: view model -> HTML string
deploy/assets/js/shared/layout.js    <head>/OG/meta + header + <main> + footer frame
```

* `shared/html.js` — tagged template `html` that escapes every interpolated value (text and quoted attributes). `safeUrl()` allows
  only same-site paths and http(s). Client code never uses `innerHTML` (`test/client-code.test.js` enforces it): `shared/mount.js` is the
  only DOM insertion point and accepts nothing but `html` output.
* A view model is a **public projection**, built field by field. It never carries `user_id`, `contact_phone`, exact coordinates or
  the two matching lists; `test/public-pages.test.js` deep-scans every page endpoint.
* Every block is hidden when its data is empty; there is no placeholder text.
* `site_settings` (migration 004) holds the editable copy; keys are whitelisted in `settings.js`, values are plain text (no HTML: a
  blank line starts a paragraph, a single line break stays a line break; markup typed into a value is shown as text).

### Editions on the home and on the tour page

* **Home, first section.** With at least one open edition that has an ISO start date: «تجربه‌های پیش‌رو», the published tours that have
  one, soonest first (max 6). With none: «تجربه‌ها», the published tours (not coming-soon) in catalogue order (max 6), each card saying
  «تاریخ بعدی به‌زودی اعلام می‌شود» with no price; no edition label leaves the server (`experiences` in the model, `nextEdition: null`).
  A site with no published tour has no such section.
* **Tour page booking card.** An edition with no ISO date that cannot be booked (closed, full) is left out of the page and of
  `GET /api/pages/tour/<slug>`: all it could show is a bare label of a date that is not coming. A tour whose editions are all like that
  reads «تاریخ بعدی اعلام می‌شود» with no booking form and no «انتخاب تاریخ» button (price still shown). A closed or full edition **with**
  an ISO date is listed as «تکمیل» (card: «ظرفیت تکمیل است»); an open undated edition is listed by its label and can be booked.

### How a tour is reserved: the switch, the three modes (migration 007)

* **`BOOKING_ONLINE_ENABLED`** (environment, read at call time, default **off**; only `true` or `1` turn it on) is the site-wide switch for the site's own
  booking and ZarinPal payment. Off: `POST /api/bookings` and `POST /api/payments/zarinpal/request` answer **409 `online_booking_disabled`** for every tour
  (before the session and the body are looked at, so an anonymous probe gets it too), a gateway callback of an old session confirms nothing (302 to
  `/booking/result?status=disabled&ref=…`, the booking stays as it is), and no page renders a booking form, a payment sentence or a booking button.
  History (`/api/bookings/me`, `/api/me/bookings/<ref>`, `/booking/result`) and the admin's booking views are unaffected; `/api/health` says which it is
  in the `x-online-booking: on|off` header (the body is still `{"status":"ok"}`), which the deploy's post-check reads. A running release that
  predates the switch sends no such header: the post-check fails, because that release would take sandbox payments.
* **`tours.booking_mode`** `online` (default, today's behaviour) | `external` | `none`, with `booking_url` (≤ 300; **https://, tel: or mailto: only**, one
  validator for the admin save and for the page: `deploy/assets/js/shared/booking.js`), `booking_label` (≤ 40, default «رزرو») and `booking_note` (≤ 200,
  plain text). What a page does is `effectiveBooking()` (`server/booking.js`) and is in the model as `booking`:

  | stored mode | switch | the booking card |
  |---|---|---|
  | `online` | on | the site's form, as before (seat counts, «رزرو این تجربه», ZarinPal) |
  | `online` | off | like `none`, plus the line «رزرو آنلاین به‌زودی فعال می‌شود» |
  | `external` (valid link) | any | the dates as information, the price, the note and **one** primary button with the label, linking to the URL (`target="_blank" rel="noopener"` for https; none for tel: / mailto:) |
  | `external` (no valid link) / `none` | any | the dates and the note, no button |

  The mobile sticky bar follows the same rules. A booking for a tour that is not effectively `online` is refused (409 `online_booking_unavailable`).
  A stored link that is not valid (it can only get there by a direct database write) never becomes a button.
* **Seat counts are shown only when the site takes the bookings itself** (effective `online`): the platform has no booking data for a tour reserved elsewhere
  (`seats_taken` is only moved by an online payment), so in the other modes the model carries no capacity, no seats left, no availability wording and no
  booking id, and an edition is «تکمیل» only when the admin closed it. If real counts are wanted for `external` tours, the admin needs a seats field it maintains (not built).
* **Dates in every mode.** A future dated edition shows its date on the tour page and, as «جمعه ۱۷ مهر» (`formatCardDateFa`: weekday, day, month), on the cards.
  A tour whose only dated edition is closed shows that date with «تکمیل» on its card (the home «تجربه‌های پیش‌رو» row still lists only editions that are open).
* **Region «تهران»** (`tehran`, tone `city`): stamp `.ck-stamp--city` on `--inverse` / `--on-inverse` (about 15:1 in both themes), `.ck-photo--city`, `.ex-dot--city`;
  it is in the admin's region selects (tours and place profiles) and in the experiences filter.
* **Role label per partner link** (`tour_hosts.role_label`, ≤ 40, plain text): the person's card says it instead of «برگزارکننده» / «هم‌برگزارکننده»; the admin sets it in
  «۴. مکان و برگزارکنندگان» next to each linked person (a venue has none) and orders them there (the lead still comes first). The people are a grid on desktop and one column on a phone.

## Caching

| What | Cache-Control |
|---|---|
| public pages and `/api/pages/*` | `public, max-age=60, stale-while-revalidate=300` (weak ETag, 304) |
| screen shells (login, account, …) | `no-cache` |
| `/assets/…?v=<hash>`, `/assets/fonts/*` | `public, max-age=31536000, immutable` |
| image variants (`*.w480.webp`, `*.og.jpg`) | immutable (nginx) |

Who is signed in is only known in the browser (`shell.js` fills the header's login slot), so pages are identical for everyone and cacheable.

## Images and video

`server/images.js` makes WebP variants and a 1200×630 link-preview crop for every uploaded image (ImageMagick via `execFile`, allow-list
policy). The home hero video is uploaded as-is through `POST /api/admin/upload-video` (mp4 magic bytes, 30 MB cap) into `/images/site/`.

**Which picture an experience card shows** (home, `/experiences`, a profile's experiences, the related row): the explicit cover
(«عکس کاور», `tours.photo_path`) when there is one, otherwise the first gallery photo (gallery order), with the WebP variants when they
exist and the original otherwise. A value that is not an `/images/<dir>/<file>` path is skipped, so the frame is empty only when the tour
has no usable image at all (`cardCover` in `server/pagemodels.js`). The **tour page** opens on the first gallery photo (the admin says
«اولی = عکس اصلی»), falling back to the cover. Image paths are stored with the leading slash; migration 006 repaired the two tours that had
them without it (`images/...`), which had made their cards empty, their galleries invisible and the admin unable to add a photo.

Upload sizes: nginx accepts a request body of 6 MB on `POST /api/admin/upload` and `POST /api/partner/profiles/<slug>/upload` (the service
accepts a 5 MB photo plus its multipart framing), 32 MB on `upload-video`, 1 MB (nginx's default) everywhere else (`deploy/nginx-site.conf.example`,
checked by `test/admin-fixes.test.js`). Before this was set, every photo over about 1 MB was refused by nginx with a 413 before the service saw it.

## Adding a page

1. `pagemodels.js`: `buildXPage()`; 2. `shared/pages/x.js`; 3. a route in `pages.js` + `GET /api/pages/x`; 4. tests like `test/public-pages.test.js`.
