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
* `site_settings` (migration 004) holds the editable copy; keys are whitelisted in `settings.js`, values are plain text.

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

## Adding a page

1. `pagemodels.js`: `buildXPage()`; 2. `shared/pages/x.js`; 3. a route in `pages.js` + `GET /api/pages/x`; 4. tests like `test/public-pages.test.js`.
