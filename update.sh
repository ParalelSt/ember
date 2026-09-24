#!/usr/bin/env bash
#
# Update a running Ember host to the latest main.
#
#   ./update.sh              pull, install, build, restart everything
#   ./update.sh --no-start   do everything except bring services back up
#                            (for hosts running Ember under systemd)
#   ./update.sh --check      show what would change, touch nothing
#   ./update.sh --here       restart Ember in this terminal even outside tmux
#
# WHERE EMBER RUNS AFTERWARDS. Run from inside tmux (or screen), Ember is
# restarted right there, in the foreground, as always. Run from a plain SSH
# shell, it is restarted in the background in a tmux session named "ember"
# (`tmux attach -t ember` to see it): started in this terminal, it would
# stop the moment the SSH window closes (bughunt O2).
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
HERE=0
for arg in "$@"; do
  case "$arg" in
    --no-start) MODE="no-start" ;;
    --check)    MODE="check" ;;
    --force)    MODE="force" ;;
    --here)     HERE=1 ;;
    "")         ;;
    *) echo "usage: $0 [--no-start|--check|--force] [--here]"; exit 1 ;;
  esac
done

ENV_FILE="$ROOT/apps/web/.env.local"
# Same reader as start-static.sh: Next's own env loader when Next is
# installed (bughunt O3), else a simple one that says so.
ENV_READER="$ROOT/scripts/read-env.mjs"
read_env() {
  local v
  if command -v node >/dev/null 2>&1 && v="$(node "$ENV_READER" "$ROOT/apps/web" "$1" 2>/dev/null)"; then
    printf '%s' "${v%.}"
    return 0
  fi
  [ -f "$ENV_FILE" ] || return 0
  echo "⚠ read $1 from apps/web/.env.local with the simple reader (Next is not installed)" >&2
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
# that looks ffmpeg up by PATH finds it too (player.py and transcribe.py ask
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
    echo "  ⚠ imageio-ffmpeg has no ffmpeg binary for this machine; tab generation and some downloads will fail"
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

# Where Ember is restarted at the end (see the top of this file). Decided
# before anything changes, so a host without tmux hears it now, not after
# Ember has been stopped.
TMUX_SESSION="ember"
if [ -n "${TMUX:-}" ] || [ -n "${STY:-}" ] || [ "$HERE" = 1 ]; then
  RELAUNCH="here"
else
  RELAUNCH="tmux"
fi
if [ "$RELAUNCH" = tmux ] && { [ "$MODE" = start ] || [ "$MODE" = force ]; } \
   && ! command -v tmux >/dev/null 2>&1; then
  echo "✗ NOT UPDATED: tmux is not installed."
  echo "  update.sh restarts Ember inside tmux, so it keeps running after you close"
  echo "  this window. Install it, then run the update again:"
  echo
  echo "      sudo apt install tmux && ./update.sh"
  echo
  echo "  Or keep Ember in this window (closing the window then stops Ember):"
  echo
  echo "      ./update.sh --here"
  echo
  exit 1
fi

# launch_ember: the last step. Here, or in the tmux session in the background
# (the tmux server, not this terminal, is then its parent, so an SSH hangup
# never reaches it). Only the ports are passed along: everything else comes
# from apps/web/.env.local, and a running tmux server would not see this
# shell's environment anyway.
launch_ember() {
  if [ "$RELAUNCH" = here ]; then
    exec "$ROOT/start-static.sh"
  fi
  local cmd pid
  # When the watchdog stops (Ctrl+C), a shell stays in the window, like a
  # tmux window where it was started by hand.
  cmd="PORT=$(printf %q "$PORT") POCKETBASE_PORT=$(printf %q "$PB_PORT") $(printf %q "$ROOT/start-static.sh"); exec \"\${SHELL:-/bin/sh}\""
  if tmux has-session -t "=$TMUX_SESSION" 2>/dev/null; then
    tmux new-window -t "$TMUX_SESSION:" -c "$ROOT" "$cmd"
  else
    tmux new-session -d -s "$TMUX_SESSION" -c "$ROOT" "$cmd"
  fi
  for _ in $(seq 1 75); do
    pid="$(tr -dc '0-9' 2>/dev/null <"$ROOT/logs/watchdog.pid" || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null \
       && ps -p "$pid" -o command= 2>/dev/null | grep -q 'start-static'; then
      echo "✓ Ember is running in the background, in tmux session \"$TMUX_SESSION\" (watchdog pid $pid)."
      echo "  It keeps running when you close this window. To watch it:"
      echo
      echo "      tmux attach -t $TMUX_SESSION      (leave it running again: Ctrl+B, then D)"
      echo
      exit 0
    fi
    sleep 0.2
  done
  echo "✗ Ember did not start in tmux. See why: tmux attach -t $TMUX_SESSION"
  exit 1
}

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
launch_ember
