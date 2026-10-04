// Online-safe daily backup: VACUUM INTO a snapshot (safe against the live
// WAL file, unlike a plain `cp`), verify it with PRAGMA integrity_check,
// gzip it, and prune backups older than RETENTION_DAYS. Meant to run as a
// systemd oneshot (see deploy/chaacme-db-backup.service).
import { DatabaseSync } from 'node:sqlite';
import { createReadStream, createWriteStream, readdirSync, statSync, unlinkSync, renameSync, mkdirSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';

const SRC_DB = process.env.CHAACME_PLATFORM_DB || '/srv/chaacme-platform/state/platform.db';
const BACKUP_DIR = process.env.CHAACME_BACKUP_DIR || '/srv/chaacme-platform/backups';
const RETENTION_DAYS = Number(process.env.CHAACME_BACKUP_RETENTION_DAYS || 14);
const NAME_RE = /^platform-\d{8}T\d{6}Z\.db\.gz$/;

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function log(msg) {
  console.log(`[backup-db] ${msg}`);
}

// Created here only for local/dev convenience (e.g. running this script
// against a scratch DB). In production the directory is pre-created by the
// install steps with deliberate ownership (chaacme-platform:ubuntu, 2750,
// setgid so backups inherit group ubuntu) — see deploy/chaacme-db-backup.service.
mkdirSync(BACKUP_DIR, { recursive: true, mode: 0o750 });

const ts = timestamp();
const snapshotPath = join(BACKUP_DIR, `.tmp-snapshot-${ts}.db`);
const finalName = `platform-${ts}.db.gz`;
const finalPath = join(BACKUP_DIR, finalName);
const tmpGzPath = join(BACKUP_DIR, `.tmp-${finalName}`);

try {
  log(`opening source db (read-only): ${SRC_DB}`);
  const db = new DatabaseSync(SRC_DB, { readOnly: true });
  try {
    log(`snapshotting via VACUUM INTO -> ${snapshotPath}`);
    db.prepare('VACUUM INTO ?').run(snapshotPath);
  } finally {
    db.close();
  }

  log('running PRAGMA integrity_check on snapshot');
  const check = new DatabaseSync(snapshotPath, { readOnly: true });
  let result;
  try {
    result = check.prepare('PRAGMA integrity_check;').get();
  } finally {
    check.close();
  }
  if (!result || result.integrity_check !== 'ok') {
    throw new Error(`integrity_check failed: ${JSON.stringify(result)}`);
  }
  log('integrity_check: ok');

  log(`gzipping -> ${tmpGzPath}`);
  await pipeline(createReadStream(snapshotPath), createGzip(), createWriteStream(tmpGzPath, { mode: 0o640 }));

  renameSync(tmpGzPath, finalPath);
  log(`backup complete: ${finalPath} (${statSync(finalPath).size} bytes)`);

  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const entry of readdirSync(BACKUP_DIR)) {
    if (!NAME_RE.test(entry)) continue;
    const p = join(BACKUP_DIR, entry);
    const st = statSync(p);
    if (st.mtimeMs < cutoff) {
      unlinkSync(p);
      log(`pruned old backup: ${entry}`);
    }
  }
} catch (err) {
  console.error(`[backup-db] FAILED: ${err.message}`);
  process.exitCode = 1;
} finally {
  try { unlinkSync(snapshotPath); } catch { /* already gone or never created */ }
  try { unlinkSync(tmpGzPath); } catch { /* already gone or never created */ }
}
