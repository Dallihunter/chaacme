import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Repo root (the release checkout in production). */
export const REPO_ROOT = join(here, '..');

// Default matches this project's local dev layout (server/ -> project root ->
// sibling images/ dir). In production set FRONTEND_STATIC_DIR to wherever the
// frontend's static tree actually is, e.g. /srv/chaacme-platform/frontend/images.
export const FRONTEND_STATIC_DIR = (process.env.FRONTEND_STATIC_DIR || join(here, '..', '..', 'images')).trim();

/** Files shipped with the release and served under /assets/ (CSS, fonts, shared + client JS). */
export const ASSETS_DIR = join(REPO_ROOT, 'deploy', 'assets');
