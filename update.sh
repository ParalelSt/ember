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
  "")         ;;
  *) echo "usage: $0 [--no-start|--check]"; exit 1 ;;
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
  echo "✗ you have uncommitted changes. Commit or stash them first:"
  git status --short | sed 's/^/    /'
  exit 1
fi

LOCK_BEFORE="$(git rev-parse HEAD:package-lock.json 2>/dev/null || echo none)"

echo "▶ pulling…"
git pull --ff-only --quiet origin main

LOCK_AFTER="$(git rev-parse HEAD:package-lock.json 2>/dev/null || echo none)"
if [ "$LOCK_BEFORE" != "$LOCK_AFTER" ]; then
  echo "▶ dependencies changed — npm ci…"
  npm ci
else
  echo "▶ dependencies unchanged — skipping npm ci"
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

echo "▶ restarting (PocketBase reboots, so pb_hooks run)…"
exec "$ROOT/start-static.sh"
