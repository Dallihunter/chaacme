# Public pages: server-rendered HTML + small client islands

Phase 1 of the frontend rebuild: the experience page `/tour/<slug>`. Home, experiences,
person/place profiles follow page by page; account, partner panel, admin and become-host stay
client-rendered (old styling) until their own phase.

## How a page is built

```
GET /tour/<slug>
  server/pages.js        route + safety-net fallback
  server/render.js       view model -> HTML, headers, caching
  server/pagemodels.js   buildTourPage(slug): the ONE function that builds the view model
  deploy/assets/js/shared/pages/tour.js   template: view model -> HTML string
GET /api/pages/tour/<slug>   the same view model as JSON
```

* Templates are plain ES-module functions (`data -> HTML`) under `deploy/assets/js/shared/`.
  The server (ESM, `"type": "module"`) imports them directly; a browser could import the same files.
* `shared/html.js` — tagged template `html` that escapes every interpolated value (text and
  quoted attributes). Template output is inserted as-is; `raw()` accepts nothing but template
  output; `safeUrl()` allows only same-site paths and http(s). No `innerHTML` with data in client code.
* The view model is a **public projection**, built field by field: no user ids, phone numbers,
  coordinates or partner matching fields. `test/render.test.js` deep-scans it.
* Client scripts only enhance (`deploy/assets/js/tour-island.js`: gallery lightbox, share button,
  sticky-bar jump, booking card). The page is complete without JavaScript.
* The booking card uses the existing endpoints: `POST /api/bookings`, `POST /api/payments/zarinpal/request`,
  and the existing ZarinPal callback -> `/booking/result` (still the SPA). Signed-out visitors are sent to
  `/login?next=/tour/<slug>`; the SPA signs them in and returns them with a full page load.

## Caching

| What | Cache-Control |
|---|---|
| `/tour/<slug>` HTML and `/api/pages/tour/<slug>` | `public, max-age=60, stale-while-revalidate=300` (weak ETag, 304) |
| `/assets/…?v=<hash>` (css, island, shared modules) and `/assets/fonts/*` | `public, max-age=31536000, immutable` |
| `/assets/…` without `?v=` | `public, max-age=300` |
| image variants `*.w480.webp`, `*.w960.webp`, `*.w1600.webp`, `*.og.jpg` | `public, max-age=31536000, immutable` (nginx; names are unique per upload) |
| 404 page | same as the HTML (`public, max-age=60, …`) |

The `?v=` is a content hash of `deploy/assets` computed once at service start; the page's import map points the
shared modules at their versioned URLs. Admin edits are therefore live within about a minute behind the CDN.

## Images

`server/images.js` runs ImageMagick through `execFile` (argument array, never a shell), with an explicit
input format prefix, a timeout, `-limit` flags, `-auto-orient` and `-strip`, under the allow-list policy in
`deploy/imagemagick-policy.xml` (JPEG/PNG/WEBP only). Variants sit next to the original: `<name>.w480.webp`,
`.w960.webp`, `.w1600.webp` (never upscaled), `<name>.og.jpg` (1200x630 cover crop, only when the source is at least
that large) and `<name>.meta.json` (sizes). New uploads also have their original re-encoded without EXIF/GPS.
Pending owner uploads get variants only after approval moves them into the public tree.
`scripts/backfill-image-variants.mjs [--dry-run] [--force] [--strip-originals]` does the same for existing images.

## Adding a page

1. `server/pagemodels.js`: `buildXPage(slug)`; 2. `shared/pages/x.js`: `renderXPage(model, ctx)`;
3. a route in `server/pages.js` + `GET /api/pages/x/<slug>` in `server/api.js`; 4. tests like `test/render.test.js`.
Components live in `shared/components/` (header, footer, experienceCard, partnerCard, statusBadge, notice, emptyState,
regionStamp, photo); site navigation lists in `shared/site.js`.
