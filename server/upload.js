import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOST_SLUG_RE } from './util.js';

const here = dirname(fileURLToPath(import.meta.url));
// Default matches this project's local dev layout (server/ -> project root ->
// sibling images/ dir, the same tree animal-flow/dasbagh already live under).
// In production set FRONTEND_STATIC_DIR to wherever the frontend's static
// tree actually is, e.g. /srv/chaacme-platform/frontend/images.
export const FRONTEND_STATIC_DIR = (process.env.FRONTEND_STATIC_DIR || join(here, '..', '..', 'images')).trim();

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_FILE_BYTES + 64 * 1024; // headroom for multipart framing + other form fields

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

/** Sniffs actual file bytes rather than trusting the client-supplied Content-Type/filename. */
function detectImageType(buf) {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (buf.length >= 8 && buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', mime: 'image/png' };
  }
  if (buf.length >= 12 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' };
  }
  return null;
}

// Unlike destroying the socket on overflow, this drains the rest of the
// request without buffering it, so the connection stays alive long enough to
// carry back a clean 413 instead of the client seeing a connection reset.
function readRawBody(req, limitBytes) {
  return new Promise((resolve) => {
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (c) => {
      if (tooLarge) return;
      size += c.length;
      if (size > limitBytes) { tooLarge = true; return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (tooLarge) resolve({ ok: false, error: 'payload_too_large' });
      else resolve({ ok: true, value: Buffer.concat(chunks) });
    });
    req.on('error', () => resolve({ ok: false, error: 'read_error' }));
  });
}

function splitBuffer(buf, delimiter) {
  const parts = [];
  let start = 0;
  let idx;
  while ((idx = buf.indexOf(delimiter, start)) !== -1) {
    parts.push(buf.slice(start, idx));
    start = idx + delimiter.length;
  }
  parts.push(buf.slice(start));
  return parts;
}

/** Minimal multipart/form-data parser: one level of fields, no nested multipart. Good enough for an admin-only upload form. */
function parseMultipart(body, boundary) {
  const marker = Buffer.from(`--${boundary}`);
  const rawParts = splitBuffer(body, marker).slice(1, -1); // drop preamble and the trailing "--" epilogue
  const CRLFCRLF = Buffer.from('\r\n\r\n');
  const fields = {};
  const files = {};

  for (let part of rawParts) {
    if (part[0] === 0x0d && part[1] === 0x0a) part = part.slice(2); // leading CRLF after the boundary marker
    if (part[part.length - 2] === 0x0d && part[part.length - 1] === 0x0a) part = part.slice(0, -2); // trailing CRLF before the next marker

    const headerEnd = part.indexOf(CRLFCRLF);
    if (headerEnd === -1) continue;
    const headerText = part.slice(0, headerEnd).toString('utf8');
    const content = part.slice(headerEnd + 4);

    const nameMatch = /(?:^|;)\s*name="([^"]*)"/i.exec(headerText);
    if (!nameMatch) continue;
    const name = nameMatch[1];

    const filenameMatch = /(?:^|;)\s*filename="([^"]*)"/i.exec(headerText);
    if (filenameMatch) files[name] = { filename: filenameMatch[1], data: content };
    else fields[name] = content.toString('utf8');
  }

  return { fields, files };
}

/**
 * Handles POST /api/admin/upload. Caller is responsible for the bearer-token
 * admin check before invoking this — same as every other /api/admin/* route.
 * Returns { ok, status, error } or { ok: true, status, path }.
 */
export async function handleUpload(req) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!contentType.startsWith('multipart/form-data') || !boundaryMatch) {
    return { ok: false, status: 400, error: 'expected_multipart' };
  }
  const boundary = boundaryMatch[1] || boundaryMatch[2];

  const raw = await readRawBody(req, MAX_BODY_BYTES);
  if (!raw.ok) return { ok: false, status: raw.error === 'payload_too_large' ? 413 : 400, error: raw.error };

  let parsed;
  try {
    parsed = parseMultipart(raw.value, boundary);
  } catch {
    return { ok: false, status: 400, error: 'invalid_multipart' };
  }

  const file = parsed.files.file;
  if (!file || !file.data || !file.data.length) return { ok: false, status: 422, error: 'file_required' };
  if (file.data.length > MAX_FILE_BYTES) return { ok: false, status: 413, error: 'file_too_large' };

  const detected = detectImageType(file.data);
  if (!detected) return { ok: false, status: 422, error: 'unsupported_file_type' };

  // Both ids are validated against a strict allowlist BEFORE they are used to
  // build any path, so a traversal attempt ("../x", "a/b", "host-../") can
  // never reach join() — it is rejected outright rather than sanitised.
  const tourId = (parsed.fields.tourId || '').trim();
  const hostSlug = (parsed.fields.hostSlug || '').trim();

  let subdir;
  if (hostSlug) {
    if (!HOST_SLUG_RE.test(hostSlug)) return { ok: false, status: 422, error: 'invalid_host_slug' };
    subdir = `host-${hostSlug}`;
  } else if (tourId) {
    if (!SAFE_ID.test(tourId)) return { ok: false, status: 422, error: 'invalid_tour_id' };
    subdir = `tour-${tourId}`;
  } else {
    subdir = 'uploads';
  }

  const dir = join(FRONTEND_STATIC_DIR, subdir);
  mkdirSync(dir, { recursive: true });

  const filename = `${Date.now()}-${randomBytes(6).toString('hex')}.${detected.ext}`;
  writeFileSync(join(dir, filename), file.data);

  return { ok: true, status: 201, path: `/images/${subdir}/${filename}` };
}

// Only ever matches paths this module itself generated (see the `path` this
// returns above): one `tour-<id>`, `host-<slug>` or `uploads` segment, one
// filename, no dots that could climb out of FRONTEND_STATIC_DIR. The host
// alternative is the slug charset only (lowercase, digits, hyphen), so
// "host-../" cannot match.
const SAFE_UPLOAD_PATH = /^\/images\/(tour-[A-Za-z0-9_-]+|host-[a-z0-9-]+|uploads)\/[A-Za-z0-9_.-]+$/;

/** Deletes a file previously returned by handleUpload's `path`. Silently no-ops on anything that doesn't match that shape or is already gone. */
export function deleteUploadedFile(imagePath) {
  if (typeof imagePath !== 'string' || !SAFE_UPLOAD_PATH.test(imagePath)) return;
  const rel = imagePath.replace(/^\/images\//, '');
  try {
    unlinkSync(join(FRONTEND_STATIC_DIR, rel));
  } catch {
    // Already missing (e.g. deleted twice, or the file predates uploads) — not an error for this endpoint.
  }
}
