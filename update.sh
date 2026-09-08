#!/usr/bin/env bash
#
# Update a running Ember host to the latest main.
#
#   ./update.sh              pull, install, build, restart everything
#   ./update.sh --no-start   do everything except bring services back up
#                            (for hosts running Ember under systemd)
#   ./update.sh --check      show what would change, touch nothing
#
# WHY THIS EXISTS, and not just `git pull && ./start-static.sh`:
# start-static.sh deliberately SKIPS starting PocketBase when it's already
# healthy, so re-running it rebuilds the web app but leaves the old PB process
# alive. Ember adds collections and fields through pb_hooks that only run on PB
# BOOT — so without a real PB restart, new features (uploads, the privacy
# switches) silently do nothing, with no error to explain why. This script
# always restarts PocketBase.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

MODE="start"
case "${1:-}" in
  --no-start) MODE="no-start" ;;
  --check)    MODE="check" ;;
  --force)    MODE="force" ;;
  "")         ;;
  *) echo "usage: $0 [--no-start|--check|--force]"; exit 1 ;;
esac

ENV_FILE="$ROOT/apps/web/.env.local"
read_env() {
  [ -f "$ENV_FILE" ] || return 0
  { grep -E "^${1}=" "$ENV_FILE" || true; } | tail -1 | cut -d= -f2- | tr -d '\r"'"'"
}
PORT="$(read_env PORT)";                     PORT="${PORT:-3000}"
PB_PORT="$(read_env POCKETBASE_PORT)";       PB_PORT="${PB_PORT:-8090}"

echo "▶ fetching…"
git fetch --quiet origin main
LOCAL="$(git rev-parse HEAD)"
REMOTE="$(git rev-parse origin/main)"

if [ "$LOCAL" = "$REMOTE" ]; then
  echo "✓ already up to date ($(git rev-parse --short HEAD))"
  [ "$MODE" = "check" ] && exit 0
else
  echo "  $(git rev-list --count HEAD..origin/main) new commit(s):"
  git log --oneline --no-decorate HEAD..origin/main | head -20 | sed 's/^/    /'
fi

if [ "$MODE" = "check" ]; then
  echo
  echo "(--check: nothing changed)"
  exit 0
fi

# Refuse to clobber local edits — on a host these are usually a hand-patched
# config someone will want back.
if ! git diff --quiet || ! git diff --cached --quiet; then
  if [ "$MODE" = "force" ]; then
    echo "▶ stashing local edits (--force)…"
    git stash push --quiet --include-untracked -m "update.sh $(date -u +%FT%TZ)"
    echo "  restore them later with: git stash pop"
  else
    echo "✗ NOT UPDATED — you have uncommitted changes, so the pull was skipped."
    git status --short | sed 's/^/    /'
    echo
    echo "  This is usually package-lock.json, which npm rewrites whenever you"
    echo "  run 'npm install' on the host. If you have not hand-edited anything:"
    echo
    echo "      git checkout -- package-lock.json && ./update.sh"
    echo
    echo "  or let the script put your edits aside for you:"
    echo
    echo "      ./update.sh --force"
    echo
    exit 1
  fi
fi

echo "▶ pulling…"
git pull --ff-only --quiet origin main

# Install against what is ACTUALLY on disk, not against what changed in this
# pull. Comparing the two commits' lockfiles looks right but silently does the
# wrong thing whenever an install was skipped or interrupted earlier: the next
# pull sees no further lockfile change and leaves node_modules missing a
# package, which surfaces much later as a type error in the build. A stamp of
# the lockfile written only after a SUCCESSFUL install is self-correcting.
LOCK_SHA="$(git hash-object package-lock.json)"
STAMP="$ROOT/.node_modules.stamp"
if [ ! -d "$ROOT/node_modules" ] || [ ! -f "$STAMP" ] || [ "$(cat "$STAMP")" != "$LOCK_SHA" ]; then
  echo "▶ installing dependencies — npm ci…"
  npm ci
  echo "$LOCK_SHA" > "$STAMP"
else
  echo "▶ dependencies already match the lockfile — skipping npm ci"
fi

# yt-dlp goes stale fast: YouTube breaks older versions every few months, and
# when it does, downloads start returning 403 while everything else looks fine.
# It has bitten this project more than once, so keep it current on every update.
if [ "${SKIP_YTDLP_UPGRADE:-0}" != "1" ] && [ -x "$ROOT/.venv/bin/pip" ]; then
  echo "▶ updating yt-dlp + ytmusicapi…"
  BEFORE="$("$ROOT/.venv/bin/python" -m yt_dlp --version 2>/dev/null || echo none)"
  "$ROOT/.venv/bin/pip" install -q --upgrade yt-dlp ytmusicapi || \
    echo "  ⚠ upgrade failed — carrying on, but 403s on downloads usually mean a stale yt-dlp"
  AFTER="$("$ROOT/.venv/bin/python" -m yt_dlp --version 2>/dev/null || echo none)"
  if [ "$BEFORE" = "$AFTER" ]; then
    echo "  yt-dlp $AFTER (already current)"
  else
    echo "  yt-dlp $BEFORE → $AFTER"
  fi
fi

if [ "$MODE" = "no-start" ]; then
  echo
  echo "✓ code updated and dependencies installed."
  echo "  Now restart your services yourself — and make sure POCKETBASE"
  echo "  actually restarts, or new collections/fields won't be created."
  exit 0
fi

# Stop the old processes. Matched on the configured ports rather than by
# name, so this can't reach past this host's own Ember.
stop_on_port() {
  local port="$1" label="$2" pids
  pids="$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "▶ stopping $label (port $port)…"
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      sleep 1
      lsof -ti tcp:"$port" -sTCP:LISTEN >/dev/null 2>&1 || return 0
    done
    echo "  still up after 10s — forcing"
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
}

stop_on_port "$PORT" "the web app"
stop_on_port "$PB_PORT" "PocketBase"

# Say plainly what is now running. "I ran the update and nothing changed" is
# otherwise indistinguishable from a rebuild of the same commit.
NOW="$(git rev-parse HEAD)"
if [ "$NOW" = "$(git rev-parse origin/main)" ]; then
  echo "✓ updated to $(git rev-parse --short HEAD) — $(git log -1 --format=%s | cut -c1-60)"
else
  echo "✗ STILL BEHIND origin/main at $(git rev-parse --short HEAD) — the pull did not take."
fi

echo "▶ restarting (PocketBase reboots, so pb_hooks run)…"
exec "$ROOT/start-static.sh"
