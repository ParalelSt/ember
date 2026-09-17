#!/usr/bin/env bash
#
# Launcher for the persistent-tunnel mode (Tailscale Funnel).
#
#   ./start-static.sh
#
# Assumes `tailscale funnel --bg $PORT` is already running (see SETUP.md).
# Starts:
#   1. PocketBase                       (127.0.0.1:${POCKETBASE_PORT}, default 8090)
#   2. Next in PRODUCTION mode          (127.0.0.1:$PORT, default 3000), proxies /pb/* to PocketBase
#
# Both ports come from the environment, else apps/web/.env.local:
#   PORT=3000
#   POCKETBASE_PORT=8090
# Either or both may be omitted to keep the defaults. See PORTS.md.
#
# Production mode (not `next dev`) is used so:
#   - No dev-origin CSRF check (Tailscale tunnel hostnames work out of the box).
#   - It's faster and stable to leave running.
# Re-run this whenever you change code (it rebuilds first).
#
# WATCHDOG. This script stays in the foreground and supervises both services:
# a service that exits on its own is restarted after a backoff (5 s, 30 s,
# then 120 s), and after 5 crashes within 10 minutes it is left down with a
# "giving up" report while the other keeps running. Every crash, give-up,
# terminal hangup and unclean-shutdown notice is posted to Discord through
# scripts/crash-report.mjs. Output also goes to logs/next.log,
# logs/pocketbase.log and logs/watchdog.log. See SETUP.md, "Crash logging".
#
# Works on macOS/Linux natively, and Windows under Git Bash. Ctrl+C stops.
#
# Test-only knobs (tests/watchdog.test.sh): WATCHDOG_BACKOFF ("5 30 120"),
# WATCHDOG_MAX_CRASHES (5), WATCHDOG_WINDOW (600 s), WATCHDOG_CMD_NEXT and
# WATCHDOG_CMD_PB (replace the two commands), WATCHDOG_SKIP_BUILD=1.
#
# Written for bash 3.2 as well (macOS's /bin/bash): no `wait -n`, no
# associative arrays, no BASHPID.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PB_DIR="$ROOT/pocketbase"
ENV_FILE="$ROOT/apps/web/.env.local"
LOG_DIR="$ROOT/logs"
WATCHDOG_LOG="$LOG_DIR/watchdog.log"
PID_FILE="$LOG_DIR/watchdog.pid"
LOCK_FILE="$LOG_DIR/ember.lock"

WATCHDOG_BACKOFF="${WATCHDOG_BACKOFF:-5 30 120}"
WATCHDOG_MAX_CRASHES="${WATCHDOG_MAX_CRASHES:-5}"
WATCHDOG_WINDOW="${WATCHDOG_WINDOW:-600}"
WATCHDOG_CMD_NEXT="${WATCHDOG_CMD_NEXT:-}"
WATCHDOG_CMD_PB="${WATCHDOG_CMD_PB:-}"
WATCHDOG_SKIP_BUILD="${WATCHDOG_SKIP_BUILD:-0}"
ROTATE_BYTES=$((5 * 1024 * 1024))
# How long a service gets to exit after SIGTERM before SIGKILL. Kept under
# update.sh's 10 s wait for the watchdog, so a planned stop finishes inside it.
STOP_GRACE=8

# The pid this watchdog runs as. Supervisor subshells read it to notice when
# the watchdog itself is gone ($$ keeps the parent's value in a subshell).
WATCHDOG_PID=$$

pick_bin() {
  if [ -f "$1" ]; then echo "$1"
  elif [ -f "$1.exe" ]; then echo "$1.exe"
  else return 1
  fi
}

PB=""
if [ -z "$WATCHDOG_CMD_PB" ]; then
  PB="$(pick_bin "$PB_DIR/pocketbase")" || { echo "✗ PocketBase binary missing in $PB_DIR (see SETUP.md prereqs)"; exit 1; }
fi

# Read PORT + POCKETBASE_PORT out of apps/web/.env.local without sourcing the
# whole file (sourcing would expose every secret in there to this shell).
read_env() {
  local key="$1"
  [ -f "$ENV_FILE" ] || return 0
  # `|| true` catches grep's no-match exit (1) so pipefail doesn't kill the
  # script via set -e when the key isn't in .env.local. Empty output then
  # flows through the rest of the pipe and we keep the default.
  { grep -E "^${key}=" "$ENV_FILE" || true; } | tail -1 | cut -d= -f2- | tr -d '\r' | tr -d '"' | tr -d "'"
}

# An explicitly exported port wins over .env.local, so a second copy (a test
# sandbox, a smoke run) can use spare ports without editing the file.
PORT="${PORT:-}"
[ -n "$PORT" ] || PORT="$(read_env PORT)"
PORT="${PORT:-3000}"

POCKETBASE_PORT="${POCKETBASE_PORT:-}"
[ -n "$POCKETBASE_PORT" ] || POCKETBASE_PORT="$(read_env POCKETBASE_PORT)"
POCKETBASE_PORT="${POCKETBASE_PORT:-8090}"

# Tell Next where PB is. Overrides whatever's in .env.local so changing
# POCKETBASE_PORT alone is enough; POCKETBASE_URL stays in sync automatically.
export POCKETBASE_URL="http://127.0.0.1:${POCKETBASE_PORT}"
export PORT

mkdir -p "$LOG_DIR"

# ── helpers ──────────────────────────────────────────────────────────────

# Terminal plus logs/watchdog.log. Every write tolerates failure: after a
# hangup the terminal is gone, and a failed echo under set -e would kill the
# watchdog halfway through stopping.
say() {
  printf '%s\n' "$*" 2>/dev/null || true
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >>"$WATCHDOG_LOG" 2>/dev/null || true
}

# post TITLE TEXT [LOGFILE]: one Discord report, in the background so a slow
# or unreachable Discord never delays a restart. HUP and INT are ignored so a
# report about the terminal closing is not killed by that same hangup.
post() {
  local title="$1" text="$2" log="${3:-}"
  if [ -n "$log" ]; then
    ( trap '' HUP INT; exec node "$ROOT/scripts/crash-report.mjs" --title "$title" --text "$text" --log "$log" --lines 50 ) \
      </dev/null >>"$WATCHDOG_LOG" 2>&1 &
  else
    ( trap '' HUP INT; exec node "$ROOT/scripts/crash-report.mjs" --title "$title" --text "$text" ) \
      </dev/null >>"$WATCHDOG_LOG" 2>&1 &
  fi
}

# One generation is enough to see what led up to the latest crash, and it
# keeps a crash-looping service from filling the disk.
rotate_log() {
  local f="$1" size
  [ -f "$f" ] || return 0
  size="$(wc -c <"$f" | tr -d ' ')"
  if [ "${size:-0}" -ge "$ROTATE_BYTES" ]; then
    mv -f "$f" "$f.1"
  fi
}

# Is PID a start-static.sh watchdog? Pids get reused after a reboot, so a live
# pid alone does not prove the old watchdog is still running.
is_watchdog_pid() {
  local pid="$1"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null || return 1
  ps -p "$pid" -o command= 2>/dev/null | grep -q 'start-static' || return 1
}

# ── supervision ──────────────────────────────────────────────────────────

# Runs one service in the foreground of this (background) subshell. The real
# commands cd into their own directory; the test overrides run from ROOT.
run_service() {
  case "$1" in
    pocketbase)
      if [ -n "$WATCHDOG_CMD_PB" ]; then cd "$ROOT" && exec bash -c "$WATCHDOG_CMD_PB"; fi
      cd "$PB_DIR" && exec "$PB" serve --http "127.0.0.1:${POCKETBASE_PORT}"
      ;;
    next)
      if [ -n "$WATCHDOG_CMD_NEXT" ]; then cd "$ROOT" && exec bash -c "$WATCHDOG_CMD_NEXT"; fi
      # Run the next binary directly. Going through `npm start` or even `npx`
      # means npm wraps next, and npm prints a noisy "code 130 / Lifecycle
      # script failed" error on SIGINT. The binary itself handles signals
      # cleanly, and the watchdog's SIGTERM reaches next itself, not a wrapper.
      cd "$ROOT/apps/web" && exec "$ROOT/node_modules/.bin/next" start -p "$PORT"
      ;;
  esac
}

# backoff_for N: seconds to wait before restart number N (1-based), the last
# listed value repeating once the list runs out.
backoff_for() {
  local n="$1" i=1 d last=0
  for d in $WATCHDOG_BACKOFF; do
    last="$d"
    if [ "$i" -ge "$n" ]; then echo "$d"; return; fi
    i=$((i + 1))
  done
  echo "$last"
}

describe_exit() {
  local rc="$1"
  if [ "$rc" -gt 128 ]; then
    echo "killed by signal $((rc - 128)) (SIG$(kill -l $((rc - 128)) 2>/dev/null || echo '?'))"
  else
    echo "exit code $rc"
  fi
}

# supervise NAME LABEL LOGFILE, run as a background subshell (one per
# service). State lives in plain globals: each subshell is its own process,
# and the TERM trap must see the same variables whatever function it lands in.
supervise() {
  SUP_NAME="$1"; SUP_LABEL="$2"; SUP_LOG="$3"
  SUP_CHILD=""; SUP_SLEEPER=""; SUP_STOPPING=0; SUP_CRASHES=""
  # Every exit status is inspected by hand; errexit would end the loop on the
  # first non-zero `wait`.
  set +e
  trap 'sup_on_term' TERM
  # Only the watchdog decides when services stop. Ignoring these here makes
  # the services inherit that, so Ctrl+C or a closed terminal cannot kill a
  # service directly and be mistaken for a crash; the watchdog's own trap
  # sends the SIGTERM instead.
  trap '' HUP INT

  while :; do
    [ "$SUP_STOPPING" = 1 ] && exit 0
    rotate_log "$SUP_LOG"
    # Output to the log file and to the terminal. $! is the service itself:
    # the process substitution is created inside the forked child.
    run_service "$SUP_NAME" > >(tee -a "$SUP_LOG") 2>&1 &
    SUP_CHILD=$!
    # A stop that landed between the fork and the line above found no child
    # to signal; deliver it now, or the wait below would sit until the
    # service exits by itself.
    [ "$SUP_STOPPING" = 1 ] && kill -TERM "$SUP_CHILD" 2>/dev/null
    say "▶ $SUP_LABEL started (pid $SUP_CHILD)"

    wait "$SUP_CHILD"
    local rc=$?
    if [ "$SUP_STOPPING" = 1 ]; then
      sup_stop_child
      exit 0
    fi
    SUP_CHILD=""

    # A shutdown signal can reach the service a moment before it reaches the
    # watchdog (system shutdown TERMs everything at once). Let any pending
    # trap run before calling this a crash.
    sup_sleep 1
    [ "$SUP_STOPPING" = 1 ] && exit 0
    # The watchdog was killed outright (kill -9): nobody would stop a restarted
    # service later, so leave it down instead of orphaning a restart loop.
    kill -0 "$WATCHDOG_PID" 2>/dev/null || exit 0

    local now t kept="" count=0
    now="$(date +%s)"
    for t in $SUP_CRASHES; do
      if [ $((now - t)) -lt "$WATCHDOG_WINDOW" ]; then kept="$kept $t"; count=$((count + 1)); fi
    done
    SUP_CRASHES="$kept $now"
    count=$((count + 1))

    local reason window_min
    reason="$(describe_exit "$rc")"
    window_min=$(( (WATCHDOG_WINDOW + 59) / 60 ))

    if [ "$count" -ge "$WATCHDOG_MAX_CRASHES" ]; then
      say "✗ $SUP_LABEL crashed ($reason), $count crashes within ${window_min} min: giving up on it"
      post "Ember: giving up on $SUP_LABEL" \
        "$SUP_LABEL crashed $count times within ${window_min} min (last: $reason), so the watchdog stopped restarting it. The rest of Ember keeps running. Fix the cause, then restart Ember." \
        "$SUP_LOG"
      exit 0
    fi

    local delay
    delay="$(backoff_for "$count")"
    say "✗ $SUP_LABEL crashed ($reason), crash $count of $WATCHDOG_MAX_CRASHES within ${window_min} min; restarting in ${delay}s"
    post "Ember: $SUP_LABEL crashed" \
      "$SUP_LABEL exited unexpectedly ($reason). Restarting in ${delay}s (crash $count of $WATCHDOG_MAX_CRASHES allowed within ${window_min} min)." \
      "$SUP_LOG"

    sup_sleep "$delay"
    [ "$SUP_STOPPING" = 1 ] && exit 0
    kill -0 "$WATCHDOG_PID" 2>/dev/null || exit 0
  done
}

# Sleeps in the background and waits, so a stop during a backoff of up to two
# minutes is handled at once rather than when the sleep ends.
sup_sleep() {
  [ "$1" -gt 0 ] 2>/dev/null || return 0
  sleep "$1" &
  SUP_SLEEPER=$!
  [ "$SUP_STOPPING" = 1 ] && kill "$SUP_SLEEPER" 2>/dev/null
  wait "$SUP_SLEEPER"
  SUP_SLEEPER=""
}

# shellcheck disable=SC2329  # called from a trap
sup_on_term() {
  SUP_STOPPING=1
  if [ -n "$SUP_SLEEPER" ]; then kill "$SUP_SLEEPER" 2>/dev/null; fi
  if [ -n "$SUP_CHILD" ]; then kill -TERM "$SUP_CHILD" 2>/dev/null; fi
}

# Waits for the (already SIGTERMed) service to exit, SIGKILLing it after
# STOP_GRACE. `wait` also reaps it: polling `kill -0` instead would keep
# seeing the zombie as alive.
sup_stop_child() {
  [ -n "$SUP_CHILD" ] || return 0
  # `&&`: when the sleep is cut short below, the SIGKILL is skipped, so it can
  # never land on a reused pid.
  ( sleep "$STOP_GRACE" && kill -KILL "$SUP_CHILD" 2>/dev/null ) &
  local timer=$!
  # A second SIGTERM must not interrupt this wait, or the loop would exit
  # while the service is still shutting down.
  trap '' TERM
  wait "$SUP_CHILD" 2>/dev/null
  pkill -P "$timer" sleep 2>/dev/null || kill -KILL "$timer" 2>/dev/null
  wait "$timer" 2>/dev/null
  say "■ $SUP_LABEL stopped"
}

SUPERVISORS=""
BUILD_PID=""
STOPPING=0

stop_supervisors() {
  local pid
  for pid in $SUPERVISORS; do kill -TERM "$pid" 2>/dev/null || true; done
  for pid in $SUPERVISORS; do wait "$pid" 2>/dev/null || true; done
  SUPERVISORS=""
}

release_lock() {
  rm -f "$PID_FILE" "$LOCK_FILE"
}

# Every planned stop ends here: Ctrl+C, SIGTERM (update.sh, systemd, kill) and
# SIGHUP (the SSH / PuTTY window closed). None of them is a crash.
# shellcheck disable=SC2329  # called from a trap
on_signal() {
  local sig="$1"
  [ "$STOPPING" = 1 ] && return 0
  STOPPING=1
  trap '' INT TERM HUP
  if [ "$sig" = HUP ]; then
    say "✗ the terminal session closed (SIGHUP); stopping Ember"
    post "Ember stopped: terminal closed" \
      "Ember stopped: the terminal session closed (SIGHUP). Start it inside tmux, or with nohup, so it keeps running after you disconnect."
  else
    say ""
    say "▶ stopping… ($sig)"
  fi
  if [ -n "$BUILD_PID" ]; then
    kill_tree "$BUILD_PID"
    wait "$BUILD_PID" 2>/dev/null || true
  fi
  stop_supervisors
  release_lock
  say "■ watchdog stopped"
  exit 0
}

# The build is npx -> node -> worker processes; TERM to the top one alone
# would leave the rest compiling.
# shellcheck disable=SC2329  # called from a trap
kill_tree() {
  local pid="$1" kid
  for kid in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$kid"; done
  kill -TERM "$pid" 2>/dev/null || true
}

# ── unclean shutdown check, then claim the lock ──────────────────────────

UNCLEAN_SINCE=""
if [ -f "$LOCK_FILE" ]; then
  old_pid="$(sed -n 's/^pid=//p' "$LOCK_FILE" | head -1)"
  if is_watchdog_pid "$old_pid"; then
    echo "✗ Ember is already running here (watchdog pid $old_pid)."
    echo "  Stop it first: Ctrl+C in its terminal, or: kill $old_pid"
    exit 1
  fi
  UNCLEAN_SINCE="$(sed -n 's/^started=//p' "$LOCK_FILE" | head -1)"
  UNCLEAN_SINCE="${UNCLEAN_SINCE:-an unknown time}"
fi

printf 'pid=%s\nstarted=%s\n' "$$" "$(date '+%Y-%m-%d %H:%M:%S %Z')" >"$LOCK_FILE"
echo "$$" >"$PID_FILE"
say "▶ watchdog started (pid $$)"

# Traps go in right after the lock is ours: earlier, a stop would remove a
# lock that belongs to another running copy.
trap 'on_signal INT' INT
trap 'on_signal TERM' TERM
trap 'on_signal HUP' HUP

if [ -n "$UNCLEAN_SINCE" ]; then
  say "⚠ the previous run (started $UNCLEAN_SINCE) did not shut down cleanly"
  post "Ember: unclean shutdown" \
    "Ember started after an unclean shutdown (machine reboot, power loss, or the process was killed). The previous run started at $UNCLEAN_SINCE."
fi

# ── start ────────────────────────────────────────────────────────────────

# Skip starting PB if it's already running and no watchdog owns it (e.g. the
# user started it manually). Avoids a port-conflict crash loop.
if [ -z "$WATCHDOG_CMD_PB" ] && curl -fsS -m 1 "http://127.0.0.1:${POCKETBASE_PORT}/api/health" > /dev/null 2>&1; then
  say "▶ PocketBase already running on :${POCKETBASE_PORT}, skipping start (not supervised)."
else
  say "▶ starting PocketBase on :${POCKETBASE_PORT}…"
  supervise pocketbase PocketBase "$LOG_DIR/pocketbase.log" &
  SUPERVISORS="$SUPERVISORS $!"
fi

if [ "$WATCHDOG_SKIP_BUILD" != 1 ]; then
  say "▶ building the web app (production, webpack)…"
  # --webpack opts out of Turbopack, which refuses to follow the .venv/bin/python
  # symlink that escapes the project root (used by lib/sources/youtube.ts to
  # spawn the Python player). Webpack happily ignores it.
  # Run in the background and wait, so Ctrl+C / SIGTERM during a long build is
  # handled straight away instead of after it finishes.
  ( cd "$ROOT/apps/web" && exec npx next build --webpack ) &
  BUILD_PID=$!
  if ! wait "$BUILD_PID"; then
    BUILD_PID=""
    # A failed build leaves nothing to serve, and a PocketBase supervisor left
    # behind would be an orphaned restart loop; stop it and exit plainly.
    say "✗ build failed; stopping PocketBase. Fix the error above and run ./start-static.sh again."
    STOPPING=1
    trap '' INT TERM HUP
    stop_supervisors
    release_lock
    exit 1
  fi
  BUILD_PID=""
fi

say "▶ starting Next on :${PORT} (production)…"
supervise next Next "$LOG_DIR/next.log" &
SUPERVISORS="$SUPERVISORS $!"

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  📱  App is live at your Tailscale Funnel URL"
echo "      (https://ember.<your-tailnet>.ts.net)"
echo ""
echo "  🔧  PocketBase admin (local only):"
echo "      http://127.0.0.1:${POCKETBASE_PORT}/_/"
echo ""
echo "  🪵  Logs: $LOG_DIR"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  (Ctrl+C to stop. Closing the terminal stops it too: use tmux.)"
echo ""

# Returns when every supervisor has ended on its own, which only happens when
# each one gave up. A signal interrupts this wait and on_signal takes over.
# shellcheck disable=SC2086
wait $SUPERVISORS || true
say "✗ every supervised service has stopped; the watchdog exits"
release_lock
exit 1
