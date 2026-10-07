#!/usr/bin/env bash
#
# One maintenance window for a release that needs a new nginx vhost AND a new app (the unify-site release):
#
#   sudo scripts/switch-vhost-and-deploy.sh <new-vhost-file> <commit>
#
#   1. backs up the live vhost (timestamped, next to it in sites-available -- never under a web root)
#   2. installs the new vhost atomically, runs `nginx -t`; if that fails the old vhost is put back and NOTHING is reloaded
#   3. reloads nginx, then IMMEDIATELY runs the deploy script (deploy-prod.sh <commit>) -- the hash-verified copy of the
#      target commit's own script, so its post-checks gate this very release
#   4. if the deploy fails (deploy-prod.sh has already rolled the app back), the old vhost is restored and nginx reloaded
#
# Why one window: the new post-checks require nginx to proxy the pages to the app, and the new app needs those proxies,
# so neither order works with the other half still old (docs/DEPLOY.md, unify-site release). The only exposure is the
# few seconds between the reload and the service restart, when the old app answers the new page paths with a 404.
#
# Environment (defaults are the production host's; the tests override the commands):
#   DEPLOY_SCRIPT      the deploy script to run (default: scripts/deploy-prod.sh next to this file)
#   VHOST              the live vhost file (default /etc/nginx/sites-available/chaacme-domains.conf)
#   EXPECT_SHA256      if set, <new-vhost-file> must have exactly this sha256 (compute it on the laptop; refuses otherwise)
#   NGINX_TEST_CMD     default `nginx -t`
#   NGINX_RELOAD_CMD   default `systemctl reload nginx`
#   WINDOW_LOG         appended to as well as stdout (default /srv/chaacme-platform/deploy.log)
#
# Exit status: 0 deployed; 1 nothing changed (refused or the new vhost was invalid); 2 the deploy failed and the old vhost
# is back in place (the app was rolled back by the deploy script); 3 a failure whose restore ALSO failed: manual attention.

set -euo pipefail

NEW="${1:-}"; COMMIT="${2:-}"
[ -n "$NEW" ] && [ -n "$COMMIT" ] || { echo "usage: $0 <new-vhost-file> <commit>" >&2; exit 1; }

HERE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
DEPLOY_SCRIPT="${DEPLOY_SCRIPT:-$HERE/deploy-prod.sh}"
VHOST="${VHOST:-/etc/nginx/sites-available/chaacme-domains.conf}"
NGINX_TEST_CMD="${NGINX_TEST_CMD:-nginx -t}"
NGINX_RELOAD_CMD="${NGINX_RELOAD_CMD:-systemctl reload nginx}"
WINDOW_LOG="${WINDOW_LOG:-/srv/chaacme-platform/deploy.log}"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
BAK="$VHOST.bak-unify-$TS"
log() { printf '%s [window %s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$TS" "$*" | tee -a "$WINDOW_LOG" >&2; }

[ -f "$NEW" ] || { echo "no such file: $NEW" >&2; exit 1; }
[ -f "$VHOST" ] || { echo "no such vhost: $VHOST" >&2; exit 1; }
[ -x "$DEPLOY_SCRIPT" ] || { echo "not executable: $DEPLOY_SCRIPT" >&2; exit 1; }
if [ -n "${EXPECT_SHA256:-}" ]; then
  got="$(sha256sum "$NEW" | cut -d' ' -f1)"
  [ "$got" = "$EXPECT_SHA256" ] || { log "REFUSING: $NEW has sha256 $got, expected $EXPECT_SHA256"; exit 1; }
fi

# the currently live config must be sound before anything is touched
if ! $NGINX_TEST_CMD >/dev/null 2>&1; then log "REFUSING: nginx -t already fails on the live config"; exit 1; fi

cp -a "$VHOST" "$BAK"
cmp -s "$VHOST" "$BAK" || { log "REFUSING: the backup $BAK differs from the live vhost"; rm -f "$BAK"; exit 1; }
log "vhost backed up: $BAK (sha256 $(sha256sum "$BAK" | cut -c1-16))"

restore() { # put the old vhost back and reload; returns non-zero if that did not work
  local rc=0
  cp -a "$BAK" "$VHOST" || rc=1
  if [ "$rc" -eq 0 ] && $NGINX_TEST_CMD >/dev/null 2>&1 && $NGINX_RELOAD_CMD; then log "old vhost restored and reloaded"; else
    log "VHOST RESTORE FAILED -- MANUAL ATTENTION: cp -a $BAK $VHOST && nginx -t && systemctl reload nginx"; return 1
  fi
}

# an interrupt in the middle of the window must not leave the new vhost with the old app
on_signal() { log "interrupted: restoring the old vhost"; restore || exit 3; exit 2; }
trap on_signal INT TERM HUP

# --- 2. install atomically, test ---
tmp="$(mktemp "$VHOST.new.XXXXXX")"
cp "$NEW" "$tmp"; chmod 0644 "$tmp"
mv -f "$tmp" "$VHOST"
if ! $NGINX_TEST_CMD >/dev/null 2>&1; then
  log "nginx -t FAILED on the new vhost; putting the old one back (nothing was reloaded)"
  cp -a "$BAK" "$VHOST"
  if $NGINX_TEST_CMD >/dev/null 2>&1; then exit 1; fi
  log "VHOST RESTORE FAILED -- MANUAL ATTENTION: cp -a $BAK $VHOST && nginx -t && systemctl reload nginx"; exit 3
fi
log "nginx -t ok on the new vhost (sha256 $(sha256sum "$VHOST" | cut -c1-16))"

# --- 3. reload, then straight into the deploy ---
if ! $NGINX_RELOAD_CMD; then log "nginx reload FAILED"; restore || exit 3; exit 2; fi
log "nginx reloaded; deploying $COMMIT with $DEPLOY_SCRIPT"
set +e
"$DEPLOY_SCRIPT" "$COMMIT"
rc=$?
set -e

# --- 4. outcome ---
trap - INT TERM HUP
if [ "$rc" -eq 0 ]; then
  log "=== window OK: new vhost live, $COMMIT deployed. Rollback: sudo cp -a $BAK $VHOST && sudo nginx -t && sudo systemctl reload nginx   THEN   sudo $HERE/deploy-prod.sh rollback ==="
  exit 0
fi
log "deploy FAILED (exit $rc; deploy-prod.sh rolls the app back itself); restoring the old vhost"
restore || exit 3
exit 2
