#!/usr/bin/env node
// Generates responsive variants (WebP 480/960/1600 + the 1200x630 link-preview
// JPEG) for every image already in the public images tree. Idempotent: an image
// whose variants and meta file exist is skipped, so it is safe to re-run after
// every deploy or after new images arrived by other means.
//
//   FRONTEND_STATIC_DIR=/srv/.../frontend/images node scripts/backfill-image-variants.mjs [--dry-run] [--force] [--strip-originals]
//
//   --dry-run          list what would be generated, change nothing
//   --force            regenerate even when variants already exist
//   --strip-originals  also re-encode the ORIGINAL without EXIF/GPS (what new uploads already get).
//                      Off by default: it rewrites files that are in use.
//
// Needs ImageMagick (see deploy/imagemagick-policy.xml). Exit codes: 0 ok, 1 some
// images failed, 2 ImageMagick not available.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { FRONTEND_STATIC_DIR } from '../server/paths.js';
import { processPublicImage, publicPathToFile, isGeneratedFile, imageToolAvailable, describeImage } from '../server/images.js';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const force = args.has('--force');
const stripOriginals = args.has('--strip-originals');
const EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function* walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name !== 'pending') yield* walk(p); } else yield p;
  }
}

if (!existsSync(FRONTEND_STATIC_DIR)) {
  console.error(`images directory not found: ${FRONTEND_STATIC_DIR} (set FRONTEND_STATIC_DIR)`);
  process.exit(1);
}
if (!dryRun && !(await imageToolAvailable())) {
  console.error('ImageMagick (magick or convert) is not installed or not runnable: nothing generated.');
  process.exit(2);
}

const summary = { scanned: 0, generated: 0, upToDate: 0, skippedUnsafeName: 0, rejected: 0, failed: 0 };
for (const file of walk(FRONTEND_STATIC_DIR)) {
  if (!EXT.has(extname(file).toLowerCase()) || isGeneratedFile(file)) continue;
  summary.scanned++;
  const publicPath = `/images/${relative(FRONTEND_STATIC_DIR, file).split(sep).join('/')}`;
  if (!publicPathToFile(publicPath)) { summary.skippedUnsafeName++; console.log(`skip (name not allowed): ${publicPath}`); continue; }
  const have = describeImage(publicPath);
  if (!force && have && have.variants.length) { summary.upToDate++; continue; }
  if (dryRun) { summary.generated++; console.log(`would generate: ${publicPath}`); continue; }
  const r = await processPublicImage(publicPath, { stripOriginal: stripOriginals });
  if (r.status === 'ok') { summary.generated++; console.log(`ok: ${publicPath} (${r.meta.variants.map((v) => v.width).join('/')}${r.meta.og ? ' + og' : ''})`); }
  else if (r.status === 'rejected') { summary.rejected++; console.log(`rejected (${r.reason}): ${publicPath}`); }
  else { summary.failed++; console.log(`failed (${r.status}${r.reason ? `: ${r.reason}` : ''}): ${publicPath}`); }
}

console.log(`\n${dryRun ? 'DRY RUN — ' : ''}scanned ${summary.scanned}: ${summary.generated} ${dryRun ? 'to generate' : 'generated'}, ${summary.upToDate} already up to date, ${summary.rejected} rejected, ${summary.skippedUnsafeName} skipped (unsafe name), ${summary.failed} failed`);
process.exit(summary.failed ? 1 : 0);
