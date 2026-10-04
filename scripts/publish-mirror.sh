#!/usr/bin/env bash
#
# Refresh the PUBLIC GitHub mirror from the server repo.
#
#   scripts/publish-mirror.sh [--dry-run | --confirm <token>] [--source <commit>]
#
# GitHub is a sanitized snapshot, never a copy of the server's history. This
# script:
#   1. checks out github/main in a temporary worktree,
#   2. replaces its whole tree with the source commit's tree minus the
#      exclusions in scripts/mirror-exclude.txt,
#   3. scans the result for secrets, the origin's identity (the values in
#      deploy/target.local), IP addresses, e-mail addresses, media and large
#      files -- and ABORTS on any hit,
#   4. prints the diff stat against github/main,
#   5. only then, after you type "publish", commits "sync from server <hash>"
#      (author = your git config; it will be PUBLIC) and pushes it as an
#      ordinary fast-forward on top of github/main. Never --force.
#
# --dry-run stops after step 4 and pushes nothing. The source defaults to the
# server's main; a real publish refuses any commit that is not on it, so
# unpushed work can never reach the public repo. (--dry-run accepts any commit,
# so a branch can be previewed before it is pushed to the server.)
#
# --confirm <token> replaces the typed "publish" for a run that has no terminal
# (a person reviews the dry-run, says "publish", and someone else runs this). The
# dry-run prints the token: a hash of the exact tree that would be published, the
# github/main commit it would sit on, the commit author and the commit message.
# --confirm redoes every step above (fetch, tree, scan) and publishes ONLY if the
# token it computes now is identical; any difference -- new commit on the server
# or on github/main, other exclusions, other author -- aborts with nothing pushed.
# It also refuses an author that is not a GitHub no-reply address. --dry-run and
# --confirm cannot be combined. Without --confirm the typed prompt is unchanged.
#
# Needs remotes `server` and `github` (see docs/DEPLOY.md).

set -euo pipefail

MIRROR_REMOTE=github
MIRROR_BRANCH=main
SERVER_REMOTE=server
MIRROR_URL_RE='github\.com[:/]Dallihunter/chaacme(\.git)?$'
MAX_FILE_BYTES=$((2 * 1024 * 1024))
# Addresses that are public by design and may appear in the mirror.
ALLOWED_EMAILS=(hello@chaacme.com noreply@anthropic.com)

die() { printf 'publish-mirror: %s\n' "$*" >&2; exit 1; }

dry=0; src_arg=""; confirm=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry=1 ;;
    --source) shift; src_arg="${1:-}"; [ -n "$src_arg" ] || die "--source needs a commit" ;;
    --confirm) shift; confirm="${1:-}"; [ -n "$confirm" ] || die "--confirm needs the token printed by --dry-run" ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

[ -z "$confirm" ] || [ "$dry" -eq 0 ] || die "--dry-run and --confirm cannot be combined"
[ -z "$confirm" ] || [[ "$confirm" =~ ^[0-9a-f]{20}$ ]] || die "--confirm takes the 20-hex-digit token printed by --dry-run"

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

url="$(git remote get-url "$MIRROR_REMOTE" 2>/dev/null)" || die "no '$MIRROR_REMOTE' remote"
[[ "$url" =~ $MIRROR_URL_RE ]] || die "remote '$MIRROR_REMOTE' is not the public mirror repo ($url)"
git remote get-url "$SERVER_REMOTE" >/dev/null 2>&1 || die "no '$SERVER_REMOTE' remote"

# Fetches over HTTPS through a proxy fail transiently now and then; retry.
retry() { local n; for n in 1 2 3 4; do "$@" && return 0; echo "  (attempt $n failed: $*)" >&2; sleep 2; done; return 1; }
echo "fetching $SERVER_REMOTE and $MIRROR_REMOTE ..."
retry git fetch -q "$SERVER_REMOTE" || die "cannot fetch $SERVER_REMOTE"
retry git fetch -q "$MIRROR_REMOTE" "$MIRROR_BRANCH" || die "cannot fetch $MIRROR_REMOTE"

SRC="$(git rev-parse --verify "${src_arg:-$SERVER_REMOTE/main}^{commit}")" || die "cannot resolve source"
SHORT="$(git rev-parse --short "$SRC")"
if git merge-base --is-ancestor "$SRC" "$SERVER_REMOTE/main"; then
  echo "source $SHORT is on $SERVER_REMOTE/main"
elif [ "$dry" -eq 1 ]; then
  echo "NOTE: source $SHORT is NOT on $SERVER_REMOTE/main -- fine for a dry run, a real publish would refuse it"
else
  die "source $SHORT is not on $SERVER_REMOTE/main; push it to the server first"
fi
BASE="$(git rev-parse --verify "$MIRROR_REMOTE/$MIRROR_BRANCH^{commit}")"

# exclusion pathspecs
EXCL=()
while IFS= read -r line || [ -n "$line" ]; do
  line="${line%%#*}"; line="$(printf '%s' "$line" | sed 's/[[:space:]]*$//')"
  [ -n "$line" ] && EXCL+=("$line")
done < <(git show "$SRC:scripts/mirror-exclude.txt" 2>/dev/null) || true
[ "${#EXCL[@]}" -gt 0 ] || die "$SRC has no scripts/mirror-exclude.txt (or it is empty) -- refusing to publish without an exclusion list"
SPEC=(.); for e in "${EXCL[@]}"; do SPEC+=(":(exclude)$e"); done

WT="$(mktemp -d "${TMPDIR:-/tmp}/mirror-wt.XXXXXX")"
cleanup() { git -C "$ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || true; rmdir "$WT" 2>/dev/null || true; git -C "$ROOT" worktree prune; }
trap cleanup EXIT
git worktree add -q --detach "$WT" "$BASE"

# --- replace the tree: drop everything tracked, unpack the source minus exclusions
git -C "$WT" rm -r -q -f --ignore-unmatch . >/dev/null
git archive --format=tar "$SRC" -- "${SPEC[@]}" | tar -x -C "$WT"
git -C "$WT" add -A

for e in "${EXCL[@]}"; do
  [ ! -e "$WT/$e" ] || die "exclusion failed: $e is still in the mirror tree"
done

# --- scan ---------------------------------------------------------------------
HITS="$(mktemp "${TMPDIR:-/tmp}/mirror-hits.XXXXXX")"
add_hits() { cat >> "$HITS"; }
mapfile -d '' FILES < <(git -C "$WT" ls-files -z)
[ "${#FILES[@]}" -gt 0 ] || die "mirror tree is empty"

# 1. files that must never be public, by name / type / size
for f in "${FILES[@]}"; do
  case "$f" in
    *.db|*.db-*|*.sqlite|*.sqlite3|*.pem|*.key|*.p12|*.pfx|*.bundle|*.gz|*.zip|*.tar|*.tgz|*.bak|*.bak-*|*.log) echo "forbidden file type: $f" ;;
    .env|.env.*|*/.env|*/.env.*) [ "${f##*/}" = "env.example" ] || echo "env file: $f" ;;
    deploy/target.local) echo "local target file: $f" ;;
    *.png|*.jpg|*.jpeg|*.JPG|*.JPEG|*.webp|*.gif|*.heic|*.mp4|*.mov|*.webm|*.svg|*.ico|*.pdf) echo "image/video/pdf (people may be in it; exclude it or review): $f" ;;
  esac
  sz="$(wc -c < "$WT/$f")"
  [ "$sz" -le "$MAX_FILE_BYTES" ] || echo "file over $((MAX_FILE_BYTES / 1024)) KB ($((sz / 1024)) KB): $f"
done | add_hits

# 2. the origin's identity: every sensitive value in deploy/target.local, as a fixed string
if [ -f deploy/target.local ]; then
  while IFS='=' read -r k v; do
    case "$k" in ORIGIN_HOST|SSH_USER|SERVER_REPO_PATH) [ -n "$v" ] || continue ;; *) continue ;; esac
    needle="$v"; [ "$k" = SSH_USER ] && needle="$v@"
    for f in "${FILES[@]}"; do
      { grep -n -I -F -- "$needle" "$WT/$f" 2>/dev/null || true; } | sed "s|^|$k value in $f:|" | cut -c1-160
    done
  done < deploy/target.local | add_hits
else
  echo "no deploy/target.local on this machine: cannot check for the origin's real values (static patterns still run)" >&2
fi

# 3. static patterns
scan() { # <label> <ERE> [<grep -v ERE to drop>]
  local label="$1" re="$2" drop="${3:-^$}" f
  for f in "${FILES[@]}"; do
    grep -n -I -o -E -- "$re" "$WT/$f" 2>/dev/null | grep -v -E -- "$drop" | sed "s|^|$label in $f:|" | cut -c1-160 || true
  done
}
{
  # (bracketed first letters: the patterns must not match their own text in this file)
  scan "ssh user@host"        '(^|[^A-Za-z0-9])[u]buntu@[A-Za-z0-9.-]+'
  scan "private key"          '-----BEGIN [A-Z ]*PRIVATE KEY-----'
  scan "token"                'ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{32,}'
  scan "IPv4 address"         '([0-9]{1,3}\.){3}[0-9]{1,3}' ':(127\.0\.0\.1|0\.0\.0\.0)$'
  scan "ssh url"              'ss[h]://[^ ]+' '\$'
  scan "scp/rsync target"     '[A-Za-z0-9_-]+@[0-9]{1,3}(\.[0-9]{1,3}){3}'
} | add_hits
# e-mail addresses (allow-listed ones are public by design)
allow_re="$(printf '%s\n' "${ALLOWED_EMAILS[@]}" | sed 's/[.]/\\./g' | paste -sd'|')"
scan "e-mail address" '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}' ":(${allow_re})\$|@example\\.(com|org|test)\$|@[a-z]+\\.test\$" | add_hits

# 4. the identities in the server history that would leak if they reached a file
git log "$SRC" --format='%ae%n%ce' | sort -u | { grep -v -E '^(noreply@anthropic\.com|)$' || true; } | while IFS= read -r em; do
  for f in "${FILES[@]}"; do { grep -n -I -F -- "$em" "$WT/$f" 2>/dev/null || true; } | sed "s|^|history e-mail in $f:|" | cut -c1-160; done
done | add_hits

if [ -s "$HITS" ]; then
  echo
  echo "REFUSING TO PUBLISH: the mirror tree contains something that must not be public:" >&2
  sort -u "$HITS" | head -40 >&2
  [ "$(sort -u "$HITS" | wc -l)" -le 40 ] || echo "... and $(( $(sort -u "$HITS" | wc -l) - 40 )) more" >&2
  exit 3
fi
echo "scan clean: ${#FILES[@]} files, no secrets, identity values, IPs, unexpected e-mails, media or large files"

# --- show what would change ---------------------------------------------------
echo
echo "excluded from the public mirror:"; printf '  %s\n' "${EXCL[@]}"
echo
echo "diff stat vs $MIRROR_REMOTE/$MIRROR_BRANCH ($(git rev-parse --short "$BASE")):"
if git -C "$WT" diff --cached --quiet "$BASE"; then
  echo "  (no changes -- the mirror is already up to date with $SHORT)"
  exit 0
fi
git -C "$WT" diff --cached --stat=110 "$BASE" | cat
echo
echo "$(git -C "$WT" diff --cached --name-status "$BASE" | cut -c1 | sort | uniq -c | tr '\n' ' ') (A=added M=modified D=deleted)"

# The token pins everything a reviewer looked at (see the header).
MSG="sync from server $SHORT"
TREE="$(git -C "$WT" write-tree)"
name="$(git config --get user.name || true)"; email="$(git config --get user.email || true)"
TOKEN=""
if [ -n "$name" ] && [ -n "$email" ]; then
  TOKEN="$(printf '%s\n' chaacme-mirror-token-v1 "$BASE" "$TREE" "$name <$email>" "$MSG" | sha256sum | cut -c1-20)"
fi
echo
echo "tree to publish: $TREE (on top of $(git rev-parse --short "$BASE"))"
echo "commit author (PUBLIC): ${name:-<unset>} <${email:-<unset>}>"
echo "commit message:         $MSG"
if [ -n "$TOKEN" ]; then echo "confirm token:   $TOKEN"; else echo "confirm token:   (not available: set user.name and user.email first)"; fi

if [ "$dry" -eq 1 ]; then
  echo; echo "dry run: nothing committed, nothing pushed."
  if [ -n "$TOKEN" ]; then echo "to publish without a terminal: scripts/publish-mirror.sh --confirm $TOKEN"; fi
  exit 0
fi

# --- publish ---------------------------------------------------------------------
[ -n "$name" ] && [ -n "$email" ] || die "set user.name and user.email explicitly (git config user.email ...). Git would otherwise guess an address from this machine, and the commit author is PUBLIC."
echo
echo "commit author (PUBLIC): $name <$email>"
[[ "$email" == *@users.noreply.github.com ]] || echo "WARNING: that is not a GitHub no-reply address; it will be readable by everyone."
echo "commit message:        $MSG"
echo "push:                  $MIRROR_REMOTE $MIRROR_BRANCH (fast-forward, no force)"
if [ -n "$confirm" ]; then
  [[ "$email" == *@users.noreply.github.com ]] || die "--confirm only publishes under a GitHub no-reply author; nothing pushed"
  [ "$confirm" = "$TOKEN" ] || die "token mismatch: what would be published now is not what the token was issued for (the server or github/main moved, or the tree/author/message changed). Nothing pushed. Re-run --dry-run, review it again, and use the new token."
  echo "token matches the tree, base, author and message reviewed in the dry run."
else
  [ -r /dev/tty ] || die "no terminal to ask for confirmation on; refusing (use --confirm <token> from a dry run)"
  printf "Type 'publish' to commit and push: "
  read -r answer < /dev/tty
  [ "$answer" = "publish" ] || die "not confirmed; nothing pushed"
fi

git -C "$WT" commit -q -m "$MSG"
[ "$(git -C "$WT" rev-parse 'HEAD^{tree}')" = "$TREE" ] || die "committed tree differs from the reviewed tree; nothing pushed"
git -C "$WT" push "$MIRROR_REMOTE" "HEAD:refs/heads/$MIRROR_BRANCH"
echo "published $(git -C "$WT" rev-parse --short HEAD) to $MIRROR_REMOTE/$MIRROR_BRANCH"
