import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

// scripts/switch-vhost-and-deploy.sh with stand-ins for nginx and the deploy script: the ORDER of the steps and what is
// left on disk after each way it can fail.
const SCRIPT = fileURLToPath(new URL('../scripts/switch-vhost-and-deploy.sh', import.meta.url));

function rig({ deployExit = 0, liveBroken = false, oldFailsAfterDeploy = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'chaacme-window-'));
  const events = join(dir, 'events.log');
  const vhost = join(dir, 'chaacme-domains.conf');
  const sh = (name, body) => { const p = join(dir, name); writeFileSync(p, `#!/usr/bin/env bash\n${body}\n`); chmodSync(p, 0o755); return p; };
  // "nginx -t": fails while the vhost mentions BROKEN
  const stuckOld = oldFailsAfterDeploy ? `if grep -q deploy: "${events}" && ! grep -q @site "${vhost}"; then echo test-fail-old >> "${events}"; exit 1; fi; ` : '';
  const nginxTest = sh('nginx-test.sh', `${stuckOld}if grep -q BROKEN "${vhost}"; then echo test-fail >> "${events}"; exit 1; fi; echo test-ok >> "${events}"`);
  const nginxReload = sh('nginx-reload.sh', `echo "reload:$(sha256sum "${vhost}" | cut -c1-8)" >> "${events}"`);
  const deploy = sh('deploy.sh', `echo "deploy:$1:vhost=$(sha256sum "${vhost}" | cut -c1-8)" >> "${events}"; exit ${deployExit}`);
  const live = liveBroken ? 'server { BROKEN }\n' : 'server { listen 80; location / { try_files $uri /index.html; } }\n';
  writeFileSync(vhost, live);
  const fresh = join(dir, 'new.conf');
  writeFileSync(fresh, 'server { listen 80; location @site { proxy_pass http://127.0.0.1:3100; } }\n');
  const run = (args = [fresh, 'abc1234'], env = {}) => spawnSync('bash', [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, VHOST: vhost, DEPLOY_SCRIPT: deploy, NGINX_TEST_CMD: nginxTest, NGINX_RELOAD_CMD: nginxReload, WINDOW_LOG: join(dir, 'window.log'), ...env }
  });
  const log = () => (existsSync(events) ? readFileSync(events, 'utf8').trim().split('\n') : []);
  const sha8 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 8);
  return { dir, vhost, fresh, live, run, log, sha8, read: () => readFileSync(vhost, 'utf8'), backups: () => readdirSync(dir).filter((f) => f.includes('.bak-unify-')) };
}

test('success: back up, install, test, reload, THEN deploy; the new vhost stays', () => {
  const r = rig();
  const out = r.run();
  assert.equal(out.status, 0, out.stderr);
  assert.equal(r.read(), readFileSync(r.fresh, 'utf8'));
  const newHash = r.sha8(readFileSync(r.fresh, 'utf8'));
  assert.deepEqual(r.log(), ['test-ok', 'test-ok', `reload:${newHash}`, `deploy:abc1234:vhost=${newHash}`], 'order: test live, test new, reload, deploy (with the new vhost already live)');
  assert.equal(r.backups().length, 1);
  assert.equal(readFileSync(join(r.dir, r.backups()[0]), 'utf8'), r.live, 'the backup is the old vhost, byte for byte');
  assert.match(out.stderr, /window OK/);
  assert.match(out.stderr, /deploy-prod\.sh rollback/);
});

test('an invalid new vhost: the old one is put back, nothing is reloaded, the deploy never runs', () => {
  const r = rig();
  writeFileSync(r.fresh, 'server { BROKEN }\n');
  const out = r.run();
  assert.equal(out.status, 1);
  assert.equal(r.read(), r.live);
  assert.ok(!r.log().some((l) => l.startsWith('reload') || l.startsWith('deploy')), r.log().join(' | '));
});

test('a failed deploy: the old vhost is restored and reloaded; exit 2', () => {
  const r = rig({ deployExit: 1 });
  const out = r.run();
  assert.equal(out.status, 2, out.stderr);
  assert.equal(r.read(), r.live, 'old vhost back');
  const oldHash = r.sha8(r.live);
  const log = r.log();
  assert.ok(log.includes(`reload:${oldHash}`), 'reloaded with the old vhost again: ' + log.join(' | '));
  assert.ok(log.findIndex((l) => l.startsWith('deploy')) < log.lastIndexOf(`reload:${oldHash}`), 'restore comes after the deploy attempt');
  assert.match(out.stderr, /deploy FAILED/);
});

test('a live config that already fails nginx -t is refused before anything is touched', () => {
  const r = rig({ deployExit: 1 });
  // after the deploy "runs", the live vhost is the new one; make the OLD one fail nginx -t (simulates an unrestorable state)
  writeFileSync(r.vhost, 'server { BROKEN }\n');
  const out = r.run();
  assert.equal(out.status, 1, 'the live config must be sound before anything is touched: ' + out.stderr);
  assert.match(out.stderr, /REFUSING: nginx -t already fails on the live config/);
  assert.equal(r.read(), 'server { BROKEN }\n', 'nothing was touched');
  assert.equal(r.backups().length, 0);
});

test('a failed deploy whose vhost restore also fails: exit 3 and the manual command', () => {
  const r = rig({ deployExit: 1, oldFailsAfterDeploy: true });
  const out = r.run();
  assert.equal(out.status, 3, out.stderr);
  assert.match(out.stderr, /VHOST RESTORE FAILED -- MANUAL ATTENTION: cp -a /);
  assert.equal(r.read(), r.live, 'the old vhost file content is back even though nginx would not test it');
});

test('EXPECT_SHA256 mismatch refuses before touching anything; a match proceeds', () => {
  const r = rig();
  const bad = r.run([r.fresh, 'abc1234'], { EXPECT_SHA256: '0'.repeat(64) });
  assert.equal(bad.status, 1);
  assert.equal(r.read(), r.live);
  assert.equal(r.log().length, 0);
  const good = r.run([r.fresh, 'abc1234'], { EXPECT_SHA256: createHash('sha256').update(readFileSync(r.fresh)).digest('hex') });
  assert.equal(good.status, 0, good.stderr);
});

test('missing arguments, missing files and a non-executable deploy script are refused', () => {
  const r = rig();
  assert.equal(r.run([]).status, 1);
  assert.equal(r.run([join(r.dir, 'nope.conf'), 'abc']).status, 1);
  assert.equal(r.run([r.fresh, 'abc'], { DEPLOY_SCRIPT: join(r.dir, 'missing.sh') }).status, 1);
  assert.equal(r.read(), r.live);
});
