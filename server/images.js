// Image pipeline: responsive variants for every uploaded image, made with the
// system ImageMagick (execFile with an argument array, never a shell string).
//
// For `/images/<dir>/<name>.<ext>` the files next to the original are
//   <name>.w480.webp  <name>.w960.webp  <name>.w1600.webp   (never upscaled)
//   <name>.og.jpg                                           (1200x630 cover crop, for link previews)
//   <name>.meta.json                                        (sizes + which variants exist)
//
// Nothing here may fail an upload because ImageMagick is missing: the original
// is kept, the absence is logged once, and pages fall back to the original file.
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { FRONTEND_STATIC_DIR, REPO_ROOT } from './paths.js';

export const WIDTHS = [480, 960, 1600];
export const OG_SIZE = { width: 1200, height: 630 };
export const MAX_SIDE = 16000;           // longest accepted edge, px
export const MAX_PIXELS = 100_000_000;   // 100 MP
const EXEC_TIMEOUT_MS = 60_000;
const MAX_CONCURRENT = 2;

const TYPE_PREFIX = { jpg: 'jpeg', png: 'png', webp: 'webp' };
const SAFE_BASENAME = /^[A-Za-z0-9_-][A-Za-z0-9_.-]*$/;
const IMAGE_URL = /^\/images((?:\/[A-Za-z0-9_-][A-Za-z0-9_.-]*)+)$/;

// --- locating the tool -------------------------------------------------------

let tool; // { bin, env } | null, resolved once
let warned = false;

function stagedPolicyDir() {
  if (process.env.MAGICK_CONFIGURE_PATH) return process.env.MAGICK_CONFIGURE_PATH;
  // ImageMagick only reads a file called policy.xml, so stage our shipped
  // policy under that name in a private directory.
  const dir = join(tmpdir(), `chaacme-magick-${process.getuid ? process.getuid() : 'u'}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  copyFileSync(join(REPO_ROOT, 'deploy', 'imagemagick-policy.xml'), join(dir, 'policy.xml'));
  return dir;
}

function run(bin, args, env, timeout = EXEC_TIMEOUT_MS) {
  return new Promise((resolveRun) => {
    execFile(bin, args, { env, timeout, maxBuffer: 1 << 20, windowsHide: true }, (error, stdout, stderr) => {
      resolveRun({ error, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

async function locateTool() {
  if (tool !== undefined) return tool;
  const candidates = process.env.IMAGEMAGICK_BIN ? [process.env.IMAGEMAGICK_BIN] : ['magick', 'convert'];
  const env = {
    PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin',
    LANG: 'C',
    MAGICK_CONFIGURE_PATH: stagedPolicyDir(),
    MAGICK_TEMPORARY_PATH: tmpdir()
  };
  for (const bin of candidates) {
    const r = await run(bin, ['-version'], env, 10_000);
    if (!r.error && /ImageMagick/i.test(r.stdout)) { tool = { bin, env }; return tool; }
  }
  tool = null;
  if (!warned) {
    warned = true;
    console.warn('[chaacme-platform] ImageMagick not found: images are stored as uploaded, without responsive variants.');
  }
  return tool;
}

/** Test hook: forget the cached tool lookup. */
export function resetImageTool() { tool = undefined; warned = false; }

export const imageToolAvailable = async () => !!(await locateTool());

// Plain FIFO limiter so a burst of uploads cannot run many decoders at once.
let active = 0;
const waiting = [];
async function limited(fn) {
  if (active >= MAX_CONCURRENT) await new Promise((r) => waiting.push(r));
  active++;
  try { return await fn(); } finally { active--; waiting.shift()?.(); }
}

const LIMITS = ['-limit', 'memory', '256MiB', '-limit', 'map', '512MiB', '-limit', 'disk', '1GiB',
  '-limit', 'time', '60', '-limit', 'thread', '2'];

// --- header-only size probe (no ImageMagick involved) ------------------------

/** Pixel size read straight from the file header; null when it cannot be determined. */
export function probeDimensions(buf) {
  try {
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
        const len = buf.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
      return null;
    }
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const kind = buf.toString('ascii', 12, 16);
      if (kind === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
      if (kind === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
      }
      if (kind === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
  } catch { /* fall through */ }
  return null;
}

/** True when the header-declared size is beyond what we are willing to decode. */
export function dimensionsTooLarge(dims) {
  if (!dims) return false;
  return dims.width > MAX_SIDE || dims.height > MAX_SIDE || dims.width * dims.height > MAX_PIXELS;
}

// --- paths -------------------------------------------------------------------

/** `/images/a/b.jpg` -> absolute file path inside FRONTEND_STATIC_DIR, or null if it is not one of ours. */
export function publicPathToFile(publicPath) {
  const m = IMAGE_URL.exec(String(publicPath || ''));
  if (!m) return null;
  const rel = m[1].slice(1);
  if (rel.split('/').some((seg) => seg === '.' || seg === '..' || !SAFE_BASENAME.test(seg))) return null;
  const root = resolve(FRONTEND_STATIC_DIR);
  const file = resolve(root, rel);
  return file.startsWith(root + sep) ? file : null;
}

const stem = (file) => file.replace(/\.[A-Za-z0-9]+$/, '');
const metaFileOf = (file) => `${stem(file)}.meta.json`;
const variantName = (file, width) => `${basename(stem(file))}.w${width}.webp`;
const ogName = (file) => `${basename(stem(file))}.og.jpg`;
const isVariantName = (name) => /\.(?:w\d+\.webp|og\.jpg|meta\.json)$/.test(name);

/** True for generated companions (variants, og crop, meta) so listings/backfills skip them. */
export const isGeneratedFile = isVariantName;

// --- processing --------------------------------------------------------------

function widthsFor(origWidth) {
  const smaller = WIDTHS.filter((w) => w < origWidth);
  const top = Math.min(origWidth, WIDTHS[WIDTHS.length - 1]);
  return [...new Set([...smaller, top])];
}

/**
 * Generates the variants for one stored original.
 * type: 'jpg' | 'png' | 'webp' (the sniffed type, never the file name).
 * Returns { status: 'ok'|'tool_missing'|'rejected'|'error', meta?, reason? }.
 *   rejected  - ImageMagick (or the size limits) says this is not a usable image: callers delete the upload.
 *   tool_missing/error - original kept as is.
 */
export function processImageFile(file, type, { stripOriginal = false } = {}) {
  return limited(async () => {
    const prefix = TYPE_PREFIX[type];
    if (!prefix || !SAFE_BASENAME.test(basename(file))) return { status: 'rejected', reason: 'unsupported' };

    const header = readFileSync(file).subarray(0, 64 * 1024);
    const declared = probeDimensions(header);
    if (dimensionsTooLarge(declared)) return { status: 'rejected', reason: 'dimensions' };

    const t = await locateTool();
    if (!t) return { status: 'tool_missing' };
    const input = `${prefix}:${file}[0]`;

    // 1. probe the real (EXIF-oriented) size under the resource limits
    const probe = await run(t.bin, [...LIMITS, input, '-auto-orient', '-format', '%w %h', 'info:'], t.env);
    const sizes = /^(\d+) (\d+)$/.exec(probe.stdout.trim());
    if (probe.error || !sizes) {
      const code = probe.error && probe.error.code;
      if (code === 'ENOENT') return { status: 'tool_missing' };
      // Exit status 1 is ImageMagick saying "I cannot use this file" (corrupt, a disguised format, over the policy
      // limits): the upload is refused. Anything else (killed by a sandbox/seccomp filter, a timeout, no output) is
      // a problem with the environment, not the image: keep the original rather than reject a good upload.
      return code === 1 && !probe.error.killed ? { status: 'rejected', reason: 'unreadable' } : { status: 'error', reason: 'probe_failed' };
    }
    const width = Number(sizes[1]);
    const height = Number(sizes[2]);
    if (dimensionsTooLarge({ width, height })) return { status: 'rejected', reason: 'dimensions' };

    // 2. all outputs from one decode
    const dir = dirname(file);
    const widths = widthsFor(width);
    const jobs = widths.map((w) => ({ width: w, height: Math.max(1, Math.round((height * w) / width)), name: variantName(file, w) }));
    const makeOg = width >= OG_SIZE.width && height >= OG_SIZE.height;
    const args = [...LIMITS, input, '-auto-orient', '-strip', '-colorspace', 'sRGB'];
    const tmpOf = (name) => join(dir, `.${name}.partial`);
    for (const j of jobs) {
      args.push('(', '+clone', '-resize', `${j.width}x`, '-quality', '80', '-define', 'webp:method=4',
        '-write', `webp:${tmpOf(j.name)}`, '+delete', ')');
    }
    if (makeOg) {
      args.push('(', '+clone', '-background', '#fffdf8', '-alpha', 'remove', '-alpha', 'off',
        '-resize', `${OG_SIZE.width}x${OG_SIZE.height}^`, '-gravity', 'center', '-extent', `${OG_SIZE.width}x${OG_SIZE.height}`,
        '-quality', '82', '-interlace', 'Plane', '-write', `jpeg:${tmpOf(ogName(file))}`, '+delete', ')');
    }
    args.push('null:');
    const made = await run(t.bin, args, t.env);
    const partials = [...jobs.map((j) => j.name), ...(makeOg ? [ogName(file)] : [])];
    if (made.error) {
      for (const n of partials) try { unlinkSync(tmpOf(n)); } catch { /* not created */ }
      return { status: made.error.code === 'ENOENT' ? 'tool_missing' : 'error', reason: 'convert_failed' };
    }
    for (const n of partials) renameSync(tmpOf(n), join(dir, n));

    // 3. originals carry EXIF (often GPS): re-encode without metadata, orientation baked in
    if (stripOriginal) {
      const tmp = tmpOf(basename(file));
      const q = type === 'png' ? [] : ['-quality', '92'];
      const r = await run(t.bin, [...LIMITS, input, '-auto-orient', '-strip', ...q, `${prefix}:${tmp}`], t.env);
      if (!r.error) renameSync(tmp, file); else { try { unlinkSync(tmp); } catch { /* none */ } }
    }

    const meta = {
      v: 1, width, height,
      variants: jobs.map((j) => ({ width: j.width, height: j.height, file: j.name })),
      og: makeOg ? { ...OG_SIZE, file: ogName(file) } : null
    };
    writeFileSync(metaFileOf(file), JSON.stringify(meta));
    return { status: 'ok', meta };
  });
}

/** Same, addressed by public path; the type comes from the file's own bytes. */
export async function processPublicImage(publicPath, opts) {
  const file = publicPathToFile(publicPath);
  if (!file || !existsSync(file)) return { status: 'error', reason: 'missing' };
  if (isVariantName(basename(file))) return { status: 'error', reason: 'is_variant' };
  const head = readFileSync(file).subarray(0, 12);
  const type = head[0] === 0xff && head[1] === 0xd8 ? 'jpg'
    : head.toString('hex', 0, 4) === '89504e47' ? 'png'
      : head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : null;
  if (!type) return { status: 'rejected', reason: 'unsupported' };
  return processImageFile(file, type, opts);
}

/** Fire-and-forget variant generation (approval of a pending upload). Never throws. */
export function queueVariants(publicPath) {
  processPublicImage(publicPath, { stripOriginal: true })
    .then((r) => { if (r.status === 'rejected') console.warn(`[chaacme-platform] image ${publicPath} rejected by the pipeline (${r.reason})`); })
    .catch((err) => console.error('[chaacme-platform] variant generation failed', err));
}

/** Removes the variants and meta file of an original (called when the original is deleted). */
export function deleteVariants(publicPath) {
  const file = publicPathToFile(publicPath);
  if (!file) return;
  const names = new Set([ogName(file), basename(metaFileOf(file)), ...WIDTHS.map((w) => variantName(file, w))]);
  const meta = readMeta(file);
  for (const v of meta?.variants || []) names.add(v.file);
  for (const n of names) if (isVariantName(n)) try { unlinkSync(join(dirname(file), n)); } catch { /* absent */ }
  metaCache.delete(file);
}

// --- reading what exists -----------------------------------------------------

const metaCache = new Map(); // file -> { mtimeMs, meta }

function readMeta(file) {
  const metaFile = metaFileOf(file);
  let st;
  try { st = statSync(metaFile); } catch { metaCache.delete(file); return null; }
  const hit = metaCache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit.meta;
  let meta = null;
  try {
    const parsed = JSON.parse(readFileSync(metaFile, 'utf8'));
    if (parsed && parsed.v === 1 && Array.isArray(parsed.variants)) meta = parsed;
  } catch { /* corrupt: treated as missing */ }
  metaCache.set(file, { mtimeMs: st.mtimeMs, meta });
  return meta;
}

/**
 * What a template needs to render one image: original + variants + sizes + alt/caption.
 * Always returns an object for a valid /images path (variants empty when none exist),
 * null for anything else, so a bad path can never reach an <img src>.
 */
export function describeImage(publicPath, { alt = null, caption = null } = {}) {
  if (typeof publicPath !== 'string' || !IMAGE_URL.test(publicPath)) return null;
  const file = publicPathToFile(publicPath);
  if (!file) return null;
  const dirUrl = publicPath.slice(0, publicPath.lastIndexOf('/'));
  const meta = readMeta(file);
  let width = meta?.width ?? null;
  let height = meta?.height ?? null;
  if (!meta) {
    try {
      const dims = probeDimensions(readFileSync(file).subarray(0, 64 * 1024));
      if (dims && dims.width > 0 && dims.height > 0) { width = dims.width; height = dims.height; }
    } catch { /* original not on disk (yet): no sizes */ }
  }
  return {
    path: publicPath,
    alt: alt || '',
    caption: caption || null,
    width,
    height,
    variants: (meta?.variants || []).map((v) => ({ width: v.width, height: v.height, url: `${dirUrl}/${v.file}` })),
    og: meta?.og ? { width: meta.og.width, height: meta.og.height, url: `${dirUrl}/${meta.og.file}` } : null
  };
}
