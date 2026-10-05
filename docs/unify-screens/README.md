# Screenshots of every page and screen

Produced by `test/e2e/screenshots.e2e.mjs` (headless Chromium, generated gradient images, invented names; no real photos).
`<full|minimal>-<1440|390>-<name>.jpg`: the **full** site has every optional field filled in, the **minimal** one only titles
(everything optional is hidden). Downscaled to 720 px wide for the repository; the test writes full-size PNGs to `$E2E_OUT_DIR`.

Run: `PLAYWRIGHT_CORE=<path to playwright index.mjs> CHROMIUM_PATH=<chromium> E2E_OUT_DIR=/tmp/shots node test/e2e/screenshots.e2e.mjs`
(needs ImageMagick for the fixture images).
