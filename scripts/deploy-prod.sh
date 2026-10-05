#!/usr/bin/env bash
#
# chaacme-platform production deploy.
#
#   sudo scripts/deploy-prod.sh <commit-ish>   deploy a commit that is on origin/main
#   sudo scripts/deploy-prod.sh rollback       restore the previous commit + frontend files
#   sudo scripts/deploy-prod.sh verify         run the read-only post-checks against what is live
#   sudo scripts/deploy-prod.sh check          validate deploy/target.local; changes nothing
#
# Run it from the release checkout on the production host. Where that host
# keeps things (paths, service names, site host) is LOCAL CONFIGURATION, not
# source: it is read from deploy/target.local, which is gitignored and never
# published. deploy/target.example lists every key with placeholder values.
#
# Deploys a commit that is already on origin/main, backs up the DB and the
# two hand-copied frontend files first, and rolls the whole thing back by
# itself if the service does not come up healthy or any post-check fails.
# Rollback restores the commit and the two frontend files; it does NOT touch
# the database (migrations are additive, so the previous code still runs
# against the migrated schema -- the pre-deploy DB backup is for a human).
#
# Deliberately narrow about the web root: it writes exactly two files,
# frontend/index.html and frontend/admin/index.html. images/tour-*/ and
# media/ are CONTENT uploaded through the admin panel, and one-off pages are
# not in git -- none of them are touched, and nothing here ever deletes or
# syncs the web root wholesale. There is no rsync --delete anywhere.
#
# Post-checks are strictly read-only. They must never create a host, an
# application, a booking or a review: this runs against production, and
# hosts and applications have no hard delete.

set -euo pipefail

# Re-exec from a private copy before doing anything else.
#
# This script lives inside the release dir, and a deploy checks that dir out
# to a different commit half way through -- replacing this very file while
# bash is still reading it. Bash reads a script incrementally, by byte offset,
# so the second half of a run can come from the NEW file at the OLD offset:
# either a syntax error, or worse, a spliced mixture that runs. (Seen for
# real: the post-checks added in one commit did not run on the deploy that
# installed them, because the running process was still on the old copy.)
# The same applies to `rollback`, which also checks out a different commit.
#
# Consequence worth remembering: a deploy is always executed by the script
# that was ALREADY live. New or changed post-checks therefore first run on the
# deploy AFTER the one that ships them -- land script changes in an earlier
# commit than the code they are meant to gate.
if [ "${DEPLOY_PROD_REEXEC:-}" != "1" ]; then
  self="$(readlink -f "$0")"
  copy="$(mktemp /tmp/deploy-prod.XXXXXXXX.sh)"
  cp "$self" "$copy"
  chmod 700 "$copy"
  DEPLOY_PROD_REEXEC=1 DEPLOY_PROD_SRC="$self" exec "$copy" "$@"
fi
trap 'rm -f "$0"' EXIT

# --- local configuration ------------------------------------------------------
# Parsed as DATA, never sourced: the release dir is owned by the app user, so
# executing anything from it as root would hand that user root. Only the keys
# below are accepted, and values may only contain path/URL-safe characters.
TARGET_FILE="${DEPLOY_TARGET_FILE:-$(dirname "${DEPLOY_PROD_SRC:-$0}")/../deploy/target.local}"

REQUIRED_KEYS=(RELEASE_DIR WEB_ROOT BACKUP_ROOT STATE_DB DB_BACKUP_DIR SERVICE BACKUP_SERVICE APP_USER HEALTH_URL SITE_HOST LOG)
OPTIONAL_KEYS=(SITE_PORT HEALTH_TIMEOUT)
# Used by the laptop-side tooling (docs, publish-mirror.sh) that shares the
# same file; accepted here and ignored.
LAPTOP_KEYS=(ORIGIN_HOST SSH_USER SERVER_REPO_PATH)

early_die() { printf 'deploy-prod: %s\n' "$*" >&2; exit 1; }

in_list() { local needle="$1"; shift; local x; for x in "$@"; do [ "$x" = "$needle" ] && return 0; done; return 1; }

load_target() {
  local f="$1" line key val
  [ -f "$f" ] || early_die "missing $f -- copy deploy/target.example to deploy/target.local and fill it in"
  [ -r "$f" ] || early_die "$f exists but is not readable by $(id -un) -- run it with sudo"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    [[ "$line" == *=* ]] || early_die "$f: not KEY=VALUE: $line"
    key="${line%%=*}"; val="${line#*=}"
    in_list "$key" "${REQUIRED_KEYS[@]}" "${OPTIONAL_KEYS[@]}" "${LAPTOP_KEYS[@]}" || early_die "$f: unknown key '$key'"
    [[ "$val" =~ ^[A-Za-z0-9_./:@+-]*$ ]] || early_die "$f: value of $key has characters outside [A-Za-z0-9_./:@+-]"
    printf -v "$key" '%s' "$val"
  done < "$f"
  for key in "${REQUIRED_KEYS[@]}"; do
    [ -n "${!key:-}" ] || early_die "$f: required key $key is missing or empty"
  done
  : "${SITE_PORT:=80}" "${HEALTH_TIMEOUT:=20}"
}
load_target "$TARGET_FILE"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_ID="$$-$TS"

log() { printf '%s [deploy %s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$RUN_ID" "$*" | tee -a "$LOG"; }
die() { log "FATAL: $*"; exit 1; }

# --- `check`: validate the configuration and the host, change nothing -----------
do_check() {
  local rc=0 p
  say() { printf '  %-5s %s\n' "$1" "$2"; }
  echo "target file: $TARGET_FILE"
  for p in RELEASE_DIR WEB_ROOT; do
    if [ -d "${!p}" ]; then say ok "$p is a directory"; else say FAIL "$p is not a directory"; rc=1; fi
  done
  if [ -d "$DB_BACKUP_DIR" ]; then say ok "DB_BACKUP_DIR is a directory"; else say FAIL "DB_BACKUP_DIR is not a directory"; rc=1; fi
  if [ -f "$STATE_DB" ]; then say ok "STATE_DB exists"; else say FAIL "STATE_DB does not exist"; rc=1; fi
  if [ -d "$WEB_ROOT" ] && [ -f "$WEB_ROOT/index.html" ] && [ -f "$WEB_ROOT/admin/index.html" ]; then
    say ok "web root has index.html and admin/index.html"
  else say FAIL "web root is missing index.html or admin/index.html"; rc=1; fi
  if git -C "$RELEASE_DIR" rev-parse --verify HEAD >/dev/null 2>&1; then
    say ok "release dir is a git checkout at $(git -C "$RELEASE_DIR" rev-parse --short HEAD)"
  else say FAIL "RELEASE_DIR is not a git checkout"; rc=1; fi
  command -v sqlite3 >/dev/null 2>&1 && say ok "sqlite3 is installed" || { say FAIL "sqlite3 is not installed"; rc=1; }
  command -v node >/dev/null 2>&1 && say ok "node is installed" || { say FAIL "node is not installed"; rc=1; }
  if command -v systemctl >/dev/null 2>&1; then
    for p in SERVICE BACKUP_SERVICE; do
      if systemctl cat "${!p}" >/dev/null 2>&1; then say ok "${!p} is a known unit"; else say FAIL "${!p} is not a known unit"; rc=1; fi
    done
  fi
  id "$APP_USER" >/dev/null 2>&1 && say ok "APP_USER exists" || { say FAIL "APP_USER does not exist"; rc=1; }
  [ "$rc" -eq 0 ] && echo "config OK" || echo "config has problems"
  return "$rc"
}
if [ "${1:-}" = "check" ]; then do_check; exit $?; fi

# `verify` only reads (and needs root only if the database is not readable by
# whoever runs it); deploy and rollback write root-owned files and need root.
if [ "${1:-}" != "verify" ]; then
  [ "$(id -u)" -eq 0 ] || die "must run as root (use sudo)"
  mkdir -p "$BACKUP_ROOT"
  chown root:root "$BACKUP_ROOT"
  chmod 700 "$BACKUP_ROOT"
fi
touch "$LOG"; chmod 640 "$LOG"

# curl against nginx on this box, so the checks exercise the real vhost
# (SPA fallback, deny rules) and not just the node process.
site_url() { if [ "$SITE_PORT" = 80 ]; then printf 'http://%s%s' "$SITE_HOST" "$1"; else printf 'http://%s:%s%s' "$SITE_HOST" "$SITE_PORT" "$1"; fi; }
site() { curl -s -o /dev/null -m 10 --resolve "$SITE_HOST:$SITE_PORT:127.0.0.1" -w '%{http_code}' "$(site_url "$1")"; }
site_body() { curl -s -m 10 --resolve "$SITE_HOST:$SITE_PORT:127.0.0.1" "$(site_url "$1")"; }
# POST helpers for the write-guard checks. They only ever hit routes that refuse the request before any
# handler runs (wrong Origin / wrong type), or no-op logouts with no session: nothing is created or changed.
site_post() { # <path> <curl args...> -> HTTP status
  local p="$1"; shift
  curl -s -o /dev/null -m 10 -X POST --resolve "$SITE_HOST:$SITE_PORT:127.0.0.1" -w '%{http_code}' "$@" "$(site_url "$p")"
}
site_post_headers() { # <path> <curl args...> -> response headers, CR stripped
  local p="$1"; shift
  curl -s -D - -o /dev/null -m 10 -X POST --resolve "$SITE_HOST:$SITE_PORT:127.0.0.1" "$@" "$(site_url "$p")" | tr -d '\r'
}

# Git runs as root: the bare repo is owned by the deploy user and the app user
# cannot read it. The release dir is owned by the app user, so hand it back
# after every checkout.
git_run() { git -C "$RELEASE_DIR" "$@"; }
reown() { chown -R "$APP_USER:$APP_USER" "$RELEASE_DIR"; }

current_commit() { git_run rev-parse HEAD; }

restore_frontend() { # <backup dir>
  local d="$1"
  [ -f "$d/index.html" ] && install -o root -g root -m 0644 "$d/index.html" "$WEB_ROOT/index.html"
  [ -f "$d/admin-index.html" ] && install -o root -g root -m 0644 "$d/admin-index.html" "$WEB_ROOT/admin/index.html"
}

wait_healthy() {
  local i
  for i in $(seq 1 "$HEALTH_TIMEOUT"); do
    if curl -sf -m 3 "$HEALTH_URL" >/dev/null 2>&1; then
      log "health ok after ${i}s: $(curl -s -m 3 "$HEALTH_URL")"
      return 0
    fi
    sleep 1
  done
  return 1
}

# --- row counts: a deploy must never lose data --------------------------------
# Snapshot before, compare after. "Not lower" rather than "equal": real users
# sign up and book while a deploy runs, so equality would fail a healthy
# deploy and roll it back. Read-only (sqlite3 -readonly).
COUNT_TABLES=(tours users bookings tour_dates hosts host_applications reviews)
snapshot_counts() { # prints table=N lines; returns 1 if any count could not be read
  local t n rc=0
  for t in "${COUNT_TABLES[@]}"; do
    n="$(sqlite3 -readonly "$STATE_DB" "select count(*) from $t;" 2>/dev/null)" || n=ERR
    printf '%s=%s\n' "$t" "$n"; [ "$n" = ERR ] && rc=1
  done
  n="$(sqlite3 -readonly "$STATE_DB" "select count(*) from bookings where payment_status = 'paid';" 2>/dev/null)" || n=ERR
  printf 'bookings_paid=%s\n' "$n"; [ "$n" = ERR ] && rc=1
  return "$rc"
}

# --- post-checks (read-only; create nothing) ----------------------------------
expect() { # <name> <actual> <expected>
  if [ "$2" = "$3" ]; then log "  ok   $1 ($2)"; else log "  FAIL $1 (got $2, want $3)"; return 1; fi
}

# Walks every key of a JSON document and fails on any key in the banned list.
json_banned_keys() { # <label> <comma-separated keys> <json>
  if printf '%s' "$3" | BANNED="$2" node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      const banned=new Set(process.env.BANNED.split(","));
      const hit=[];
      (function walk(n,p){
        if(Array.isArray(n)) return n.forEach((v,i)=>walk(v,p+"["+i+"]"));
        if(n && typeof n==="object") return Object.entries(n).forEach(([k,v])=>{
          if(banned.has(k)) hit.push(p+"."+k); walk(v,p+"."+k);
        });
      })(JSON.parse(s),"$");
      if(hit.length){ console.error(hit.join(", ")); process.exit(1); }
      process.exit(0);
    });' 2>/dev/null; then
    log "  ok   $1 carries none of: $2"
  else
    log "  FAIL $1 exposes a private key (one of: $2)"; return 1
  fi
}

# A place is often someone's home: the public API must never emit a
# coordinate finer than 2 decimals (~1 km), at any depth of any response.
coord_scan() { # <label> <json>
  if printf '%s' "$2" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      const bad=[];
      (function walk(n,p){
        if(Array.isArray(n)) return n.forEach((v,i)=>walk(v,p+"["+i+"]"));
        if(n && typeof n==="object") return Object.entries(n).forEach(([k,v])=>{
          if(typeof v==="number" && /^(lat|lng|latitude|longitude)$/i.test(k)
            && Math.abs(v*100-Math.round(v*100))>1e-9) bad.push(p+"."+k+"="+v);
          else walk(v,p+"."+k);
        });
      })(JSON.parse(s),"$");
      if(bad.length){ console.error(bad.join(", ")); process.exit(1); }
      process.exit(0);
    });' 2>/dev/null; then
    log "  ok   $1 exposes no coordinate finer than 2 decimals"
  else
    log "  FAIL $1 exposes an over-precise coordinate"; return 1
  fi
}

# Sets rc (global) to 1 on any failure. COUNTS_BEFORE is empty for `verify`.
run_post_checks() {
  rc=0
  log "--- post-checks ---"
  expect "GET / is 200" "$(site /)" 200 || rc=1

  local body missing=0 marker
  body="$(site_body /)"
  for marker in 'id="page-host"' 'id="page-become-host"' 'id="page-partner"'; do
    # Pure bash substring test, deliberately NOT `printf ... | grep -q`: under
    # `set -o pipefail` grep -q exits 0 on the first match and closes the pipe,
    # printf dies with SIGPIPE (141), and pipefail then reports the whole
    # pipeline as failed -- so a marker that IS present reads as missing.
    if [[ "$body" == *"$marker"* ]]; then log "  ok   / contains $marker"; else log "  FAIL / missing $marker"; missing=1; rc=1; fi
  done
  if [ "$missing" -eq 1 ]; then
    # Say what was actually served, so a stale-content failure is
    # distinguishable from a genuinely wrong build.
    log "    served by /: $(printf '%s' "$body" | wc -c) bytes, sha $(printf '%s' "$body" | sha256sum | cut -c1-12)"
    log "    on disk:     $(stat -c %s "$WEB_ROOT/index.html") bytes, sha $(sha256sum "$WEB_ROOT/index.html" | cut -c1-12)"
    log "    /index.html: sha $(site_body /index.html | sha256sum | cut -c1-12)"
  fi

  expect "GET /api/tours is 200" "$(site /api/tours)" 200 || rc=1
  tours_json="$(site_body /api/tours)"
  if printf '%s' "$tours_json" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      const t=JSON.parse(s).tours||[];
      if(!t.length) { console.error("no tours"); process.exit(1); }
      const bad=t.filter(x=>!Array.isArray(x.hosts));
      if(bad.length){ console.error("tours without a hosts array: "+bad.map(x=>x.id).join(",")); process.exit(1); }
      // Every partner entry must say what it is and what part it plays; the
      // frontend splits venue from people on exactly these two fields.
      const shapeless=[];
      for(const x of t) for(const h of x.hosts){
        if(!["person","place"].includes(h.kind) || !["lead","co_host","venue"].includes(h.role)) shapeless.push(x.id+"/"+h.slug);
      }
      if(shapeless.length){ console.error("partner entries missing kind/role: "+shapeless.join(",")); process.exit(1); }
      process.exit(0);
    });' 2>/dev/null; then
    log "  ok   every tour carries a hosts array, each entry with a kind and a role"
  else
    log "  FAIL /api/tours: hosts array or partner kind/role is wrong"; rc=1
  fi
  coord_scan "/api/tours" "$tours_json" || rc=1

  # The account-scoped routes must refuse an anonymous caller outright.
  expect "GET /api/me/profiles is 401 when logged out" "$(site /api/me/profiles)" 401 || rc=1
  expect "GET /api/me/applications is 401 when logged out" "$(site /api/me/applications)" 401 || rc=1

  expect "GET /api/hosts/does-not-exist is 404" "$(site /api/hosts/does-not-exist)" 404 || rc=1
  expect "GET /become-host is 200" "$(site /become-host)" 200 || rc=1
  expect "GET /admin/ is 200" "$(site /admin/)" 200 || rc=1
  # --- partner panel ---
  expect "GET /partner is 200" "$(site /partner)" 200 || rc=1
  expect "GET /api/partner/profiles is 401 when logged out" "$(site /api/partner/profiles)" 401 || rc=1
  expect "GET /api/partner/proposals is 401 when logged out" "$(site /api/partner/proposals)" 401 || rc=1
  expect "GET /api/admin/host-revisions is 401 when logged out" "$(site /api/admin/host-revisions)" 401 || rc=1
  expect "GET /api/admin/host-pending/<slug>/<file> is 401 when logged out" "$(site /api/admin/host-pending/deploycheck/probe.png)" 401 || rc=1

  # A partner upload waiting for review must never be reachable by URL. The
  # files are kept outside the web root, so this is the backstop: nginx must
  # answer 404 for anything shaped like one. (Without the rule the SPA fallback
  # answers 200 with the app shell, which is not a leak but is not a 404 either.)
  expect "GET a pending-upload URL is 404 publicly" "$(site /images/host-deploycheck/pending/probe.png)" 404 || rc=1

  # Public responses must carry none of the partner-private fields, on the
  # tour list and on every active profile's own page.
  local PRIVATE_KEYS="seekingPlaceTypes,acceptsExperienceTypes,seeking_place_types,accepts_experience_types,credentials,houseRules,capacityGuests,contactPhone,contact_phone,userId,user_id"
  json_banned_keys "/api/tours" "$PRIVATE_KEYS" "$tours_json" || rc=1
  local slug slugs hj n=0
  slugs="$(sqlite3 -readonly "$STATE_DB" "select slug from hosts where status = 'active' order by id limit 25;" 2>/dev/null || true)"
  while IFS= read -r slug; do
    [ -n "$slug" ] || continue
    [[ "$slug" =~ ^[a-z0-9-]{2,40}$ ]] || { log "  FAIL a host slug in the database is malformed; not requested"; rc=1; continue; }
    hj="$(site_body "/api/hosts/$slug")"
    json_banned_keys "/api/hosts/$slug" "$PRIVATE_KEYS" "$hj" || rc=1
    coord_scan "/api/hosts/$slug" "$hj" || rc=1
    n=$((n + 1))
  done <<< "$slugs"
  [ "$n" -gt 0 ] || log "  info no active host profile to scan"

  # /tour/<id> is rendered by the app as full HTML (server/render.js) once nginx proxies /tour/ to it
  # (deploy/nginx-tour.conf.example); until then nginx's SPA fallback serves the plain app shell.
  local tid
  tid="$(printf '%s' "$tours_json" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      const t=(JSON.parse(s).tours||[]).find(x=>/^[a-z0-9]+(-[a-z0-9]+)*$/.test(x.id||""));
      process.stdout.write(t ? t.id : "");
    });' 2>/dev/null || true)"
  if [ -n "$tid" ]; then
    expect "GET /tour/$tid is 200" "$(site "/tour/$tid")" 200 || rc=1
    if [ "$(site_body "/tour/$tid" | sha256sum)" = "$(site_body / | sha256sum)" ]; then
      log "  info /tour/$tid serves the plain app shell (server-rendered tour pages are not routed to the app yet)"
    elif site_body "/tour/$tid" | grep -q 'class="tp-title"'; then
      log "  ok   /tour/$tid is server-rendered"
    else
      log "  WARN /tour/$tid is neither the plain app shell nor the server-rendered page"
    fi
  fi

  # --- cross-site write guard and cookie flags ---
  # Every state-changing /api request must come from the site's own origin (403 otherwise) with a JSON
  # (or, for uploads, multipart) body (415 otherwise); the session cookies are HttpOnly + Secure, SameSite=Strict
  # for the admin session (Path=/api/admin) and SameSite=Lax for the user session. A foreign-Origin request is
  # refused before any handler runs, so these probes cannot change anything.
  local own="https://$SITE_HOST" evil="https://evil.example"
  expect "foreign-Origin POST to an admin route is refused (403)" \
    "$(site_post /api/admin/host-revisions/0/approve -H "Origin: $evil" -H 'Content-Type: application/json' --data '{}')" 403 || rc=1
  expect "foreign-Origin POST to a user route is refused (403)" \
    "$(site_post /api/auth/login -H "Origin: $evil" -H 'Content-Type: application/json' --data '{}')" 403 || rc=1
  expect "POST with neither Origin nor Referer is refused (403)" \
    "$(site_post /api/admin/logout -H 'Content-Type: application/json' --data '{}')" 403 || rc=1
  expect "same-origin POST with a text/plain body is refused (415)" \
    "$(site_post /api/auth/login -H "Origin: $own" -H 'Content-Type: text/plain' --data '{}')" 415 || rc=1

  local hdr adm usr
  hdr="$(site_post_headers /api/admin/logout -H "Origin: $own")"
  adm="$(printf '%s\n' "$hdr" | grep -i '^set-cookie: chaacme_admin_session=' | grep -i 'Path=/api/admin' || true)"
  if [[ -n "$adm" && "$adm" == *HttpOnly* && "$adm" == *Secure* && "$adm" == *SameSite=Strict* ]]; then
    log "  ok   admin session cookie is HttpOnly; Secure; SameSite=Strict; Path=/api/admin"
  else
    log "  FAIL admin session cookie flags are wrong (want HttpOnly, Secure, SameSite=Strict, Path=/api/admin): ${adm:-<no matching Set-Cookie>}"; rc=1
  fi
  hdr="$(site_post_headers /api/auth/logout -H "Origin: $own")"
  usr="$(printf '%s\n' "$hdr" | grep -i '^set-cookie: chaacme_session=' || true)"
  if [[ -n "$usr" && "$usr" == *HttpOnly* && "$usr" == *Secure* && "$usr" == *SameSite=Lax* && "$usr" == *'Path=/;'* ]]; then
    log "  ok   user session cookie is HttpOnly; Secure; SameSite=Lax; Path=/"
  else
    log "  FAIL user session cookie flags are wrong (want HttpOnly, Secure, SameSite=Lax, Path=/): ${usr:-<no matching Set-Cookie>}"; rc=1
  fi
  if printf '%s\n' "$hdr" | grep -qi 'SameSite=None'; then log "  FAIL a session cookie is SameSite=None"; rc=1; fi

  # Hygiene, not a deploy gate: whether backup URLs are blocked is an nginx
  # concern that has been turned on and off independently of any deploy, and a
  # deploy must not be held hostage to it. Warn, do not fail.
  local bakcode
  bakcode="$(site /index.html.bak-deploycheck)"
  if [ "$bakcode" = "404" ]; then
    log "  ok   a .bak URL is 404 ($bakcode)"
  else
    log "  WARN a .bak URL is $bakcode, not 404 -- nginx backup-file deny rules are not in place"
  fi

  # --- data safety ---
  local qc
  qc="$(sqlite3 -readonly "$STATE_DB" 'pragma quick_check;' 2>/dev/null || echo ERR)"
  expect "database quick_check" "$qc" ok || rc=1
  COUNTS_AFTER="$(snapshot_counts)" || { log "  FAIL could not read row counts after the deploy"; rc=1; }
  if [ -n "${COUNTS_BEFORE:-}" ]; then
    local k b a
    while IFS='=' read -r k b; do
      a="$(printf '%s\n' "$COUNTS_AFTER" | sed -n "s/^$k=//p")"
      if [[ "$a" =~ ^[0-9]+$ && "$b" =~ ^[0-9]+$ && "$a" -ge "$b" ]]; then
        log "  ok   $k did not drop ($b -> $a)"
      else
        log "  FAIL $k dropped or could not be read ($b -> ${a:-?})"; rc=1
      fi
    done <<< "$COUNTS_BEFORE"
  else
    log "  info row counts (nothing to compare against outside a deploy): $(printf '%s' "$COUNTS_AFTER" | tr '\n' ' ')"
  fi
}

# --- verify: just the checks, against whatever is live ------------------------
if [ "${1:-}" = "verify" ]; then
  COUNTS_BEFORE=""
  run_post_checks
  if [ "$rc" -eq 0 ]; then log "=== verify OK ==="; else log "=== verify FAILED ==="; fi
  exit "$rc"
fi

# --- rollback ---------------------------------------------------------------
# Restores the commit and the two frontend files saved by the last deploy.
do_rollback() { # <backup dir>
  local d="$1"
  local prev
  prev="$(cat "$d/COMMIT" 2>/dev/null || true)"
  [ -n "$prev" ] || die "rollback: no COMMIT recorded in $d"
  log "ROLLBACK -> commit $prev, frontend from $d"

  if git_run checkout -q --detach "$prev"; then reown; else
    log "rollback: git checkout FAILED (continuing to restore frontend)"
  fi
  restore_frontend "$d"
  systemctl restart "$SERVICE" || log "rollback: service restart FAILED"

  if wait_healthy; then
    log "rollback complete and healthy at $prev"
    return 0
  fi
  log "ROLLBACK FAILED: service is not healthy after restoring $prev -- MANUAL ATTENTION NEEDED"
  return 1
}

if [ "${1:-}" = "rollback" ]; then
  last="$(cat "$BACKUP_ROOT/LAST_DEPLOY" 2>/dev/null || true)"
  [ -n "$last" ] && [ -d "$BACKUP_ROOT/$last" ] || die "no previous deploy recorded in $BACKUP_ROOT/LAST_DEPLOY"
  do_rollback "$BACKUP_ROOT/$last"
  exit $?
fi

TARGET="${1:-}"
[ -n "$TARGET" ] || die "usage: $0 <commit-ish> | rollback | verify | check"

log "=== deploy requested: $TARGET ==="

# --- (a) refuse anything that is not on origin/main --------------------------
git_run fetch -q origin || die "git fetch failed"
COMMIT="$(git_run rev-parse --verify "${TARGET}^{commit}" 2>/dev/null)" \
  || die "not a commit in this repo: $TARGET"
git_run merge-base --is-ancestor "$COMMIT" origin/main \
  || die "refusing: $COMMIT is not on origin/main (push it first)"
log "target commit $COMMIT is on origin/main"

PREV_COMMIT="$(current_commit)"
log "currently deployed: $PREV_COMMIT"
if [ "$PREV_COMMIT" = "$COMMIT" ]; then
  log "already at $COMMIT -- nothing to do"
  exit 0
fi

# --- (b) baseline row counts, then the database backup (abort if it fails) ---
COUNTS_BEFORE="$(snapshot_counts)" || die "could not read row counts from the database -- aborting before touching anything"
log "row counts before: $(printf '%s' "$COUNTS_BEFORE" | tr '\n' ' ')"

log "running $BACKUP_SERVICE"
if ! systemctl start "$BACKUP_SERVICE"; then
  die "database backup failed -- aborting before touching anything"
fi
if [ "$(systemctl show -p Result --value "$BACKUP_SERVICE")" != "success" ]; then
  die "database backup did not report success -- aborting"
fi
# `ls | head -1` is the same SIGPIPE-under-pipefail trap; take the newest
# entry without a short-circuiting reader.
newest_backup="$(ls -t "$DB_BACKUP_DIR"/platform-*.db.gz 2>/dev/null | sed -n 1p || true)"
log "backup ok: ${newest_backup:-unknown}"

# --- (c) save the current commit + live frontend files -----------------------
SAVE="$BACKUP_ROOT/$TS"
mkdir -p "$SAVE"
printf '%s\n' "$PREV_COMMIT" > "$SAVE/COMMIT"
printf '%s\n' "$COUNTS_BEFORE" > "$SAVE/COUNTS_BEFORE"
cp -p "$WEB_ROOT/index.html" "$SAVE/index.html"
cp -p "$WEB_ROOT/admin/index.html" "$SAVE/admin-index.html"
chmod 700 "$SAVE"
printf '%s\n' "$TS" > "$BACKUP_ROOT/LAST_DEPLOY"
log "saved rollback point in $SAVE (commit $PREV_COMMIT)"

# Everything past here is undone by do_rollback on any failure.
fail() { log "FAILED: $*"; do_rollback "$SAVE" && exit 1 || exit 2; }

# --- (d) check out the commit and publish the two frontend files -------------
git_run checkout -q --detach "$COMMIT" || fail "git checkout $COMMIT"
reown
log "release dir now at $(current_commit)"

[ -f "$RELEASE_DIR/deploy/index.html" ] || fail "deploy/index.html missing in $COMMIT"
[ -f "$RELEASE_DIR/deploy/admin-index.html" ] || fail "deploy/admin-index.html missing in $COMMIT"
install -o root -g root -m 0644 "$RELEASE_DIR/deploy/index.html" "$WEB_ROOT/index.html" || fail "publish index.html"
install -o root -g root -m 0644 "$RELEASE_DIR/deploy/admin-index.html" "$WEB_ROOT/admin/index.html" || fail "publish admin/index.html"
log "published index.html ($(sha256sum "$WEB_ROOT/index.html" | cut -c1-12)) and admin/index.html ($(sha256sum "$WEB_ROOT/admin/index.html" | cut -c1-12))"

# --- (e) restart and wait for health -----------------------------------------
systemctl restart "$SERVICE" || fail "service restart"
wait_healthy || fail "service did not become healthy within ${HEALTH_TIMEOUT}s"

# --- (f) post-checks -----------------------------------------------------------
run_post_checks
[ "$rc" -eq 0 ] || fail "post-checks did not pass"

log "=== deploy OK: $PREV_COMMIT -> $COMMIT (rollback point $SAVE) ==="
exit 0
