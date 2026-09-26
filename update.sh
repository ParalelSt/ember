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
# Same precedence as start-static.sh: an exported port wins over .env.local.
PORT="${PORT:-}";            [ -n "$PORT" ] || PORT="$(read_env PORT)";                PORT="${PORT:-3000}"
PB_PORT="${POCKETBASE_PORT:-}"; [ -n "$PB_PORT" ] || PB_PORT="$(read_env POCKETBASE_PORT)"; PB_PORT="${PB_PORT:-8090}"

# start-static.sh's watchdog restarts any service that exits without the
# watchdog asking. Stop the watchdog FIRST (it then stops both services itself
# and does not report them as crashes); only then clear the ports, so nothing
# stopped below gets restarted or posted to Discord as a crash.
stop_watchdog() {
  local pidfile="$ROOT/logs/watchdog.pid" pid
  [ -f "$pidfile" ] || return 0
  pid="$(tr -dc '0-9' <"$pidfile")"
  # Pids get reused (a reboot leaves a stale file): only signal a process that
  # really is start-static.sh.
  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null \
     || ! ps -p "$pid" -o command= 2>/dev/null | grep -q 'start-static'; then
    rm -f "$pidfile"
    return 0
  fi
  echo "▶ stopping the watchdog (pid $pid)…"
  kill -TERM "$pid" 2>/dev/null || true
  # 20 s: the watchdog gives each service 8 s after SIGTERM, and forcing it
  # sooner would leave its lock behind, which the next start reports to
  # Discord as an unclean shutdown.
  for _ in $(seq 1 100); do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.2
  done
  # Its supervisors check that the watchdog is alive before any restart, so a
  # SIGKILL here still leaves no restart loop behind; stop_on_port below then
  # clears whatever it had not stopped yet.
  echo "  watchdog still up after 20s: forcing"
  kill -KILL "$pid" 2>/dev/null || true
}

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
    echo "  still up after 10s: forcing"
    # shellcheck disable=SC2086
    kill -9 $pids 2>/dev/null || true
  fi
}

# Every stop below relies on lsof to find what listens on the ports. Without
# it nothing would be stopped and nothing would say so.
require_lsof() {
  if ! command -v lsof >/dev/null 2>&1; then
    echo "✗ lsof is required: sudo apt install lsof"
    exit 1
  fi
}

stop_everything() {
  require_lsof
  stop_watchdog
  stop_on_port "$PORT" "the web app"
  stop_on_port "$PB_PORT" "PocketBase"
}

# Ember brings its own ffmpeg: the imageio-ffmpeg package ships a static
# binary. Install it if missing, then link it to .venv/bin/ffmpeg so anything
# that looks ffmpeg up by PATH finds it too (player.py and align.py ask
# ffmpeg_path.py directly). Relinked every run: an upgrade of the package
# renames the binary. A host never installs ffmpeg by hand.
link_ffmpeg() {
  local venv="$ROOT/.venv/bin"
  [ -x "$venv/pip" ] || return 0
  echo "▶ ffmpeg (bundled with imageio-ffmpeg)…"
  "$venv/pip" install -q imageio-ffmpeg || { echo "  ⚠ could not install imageio-ffmpeg"; return 0; }
  local exe
  exe="$("$venv/python" -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())' 2>/dev/null || true)"
  if [ -z "$exe" ] || [ ! -x "$exe" ]; then
    echo "  ⚠ imageio-ffmpeg has no ffmpeg binary for this machine; lining tabs up and some downloads will fail"
    return 0
  fi
  ln -sfn "$exe" "$venv/ffmpeg"
  echo "  $venv/ffmpeg -> $exe"
}

# Test-only: run just the stop sequence (tests/watchdog.test.sh), no git.
if [ "${UPDATE_STOP_ONLY:-0}" = "1" ]; then
  stop_everything
  exit 0
fi

# Test-only: run just the ffmpeg step (tests/ffmpeg-resolve.test.mjs), no git.
if [ "${UPDATE_FFMPEG_ONLY:-0}" = "1" ]; then
  link_ffmpeg
  exit 0
fi

[ "$MODE" = "check" ] || require_lsof

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
  # npm ci deletes node_modules first. Stop Ember before that, so the
  # running web app is not left without its dependencies, crashing, and
  # being restarted and reported by the watchdog while the install runs.
  stop_everything
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

link_ffmpeg

if [ "$MODE" = "no-start" ]; then
  echo
  echo "✓ code updated and dependencies installed."
  echo "  Now restart your services yourself — and make sure POCKETBASE"
  echo "  actually restarts, or new collections/fields won't be created."
  echo "  Give PocketBase EMBER_PB_SUPERUSER_EMAIL / EMBER_PB_SUPERUSER_PASSWORD"
  echo "  (the same values as POCKETBASE_ADMIN_* in apps/web/.env.local), or its"
  echo "  superuser is left as it is. See SETUP.md, step 4."
  exit 0
fi

stop_everything

# Say plainly what is now running. "I ran the update and nothing changed" is
# otherwise indistinguishable from a rebuild of the same commit.
NOW="$(git rev-parse HEAD)"
if [ "$NOW" = "$(git rev-parse origin/main)" ]; then
  APP_VER="$(node -p "require('$ROOT/apps/web/package.json').version" 2>/dev/null || echo '?')"
  echo "✓ updated to $APP_VER ($(git rev-parse --short HEAD)): $(git log -1 --format=%s | cut -c1-60)"
else
  echo "✗ STILL BEHIND origin/main at $(git rev-parse --short HEAD) — the pull did not take."
fi

echo "▶ restarting (PocketBase reboots, so pb_hooks run)…"
exec "$ROOT/start-static.sh"
