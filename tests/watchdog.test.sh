#!/usr/bin/env bash
#
# The start-static.sh watchdog, end to end, with fake services.
#
#   bash tests/watchdog.test.sh   # or: npm run test:watchdog
#
# No PocketBase, no Next, no build, no Discord: each scenario copies
# start-static.sh, update.sh and scripts/crash-report.mjs into a fresh temp
# ROOT (so the repo's own logs/ is never touched), swaps the two services for
# tiny fake commands through WATCHDOG_CMD_PB / WATCHDOG_CMD_NEXT, and points
# DISCORD_CRASH_WEBHOOK_URL at tests/fake-discord.mjs, which records every
# post. Ports are picked free at random. Prints PASS/FAIL per check and exits
# non-zero if any failed.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/watchdog-test.XXXXXX")"
POSTS="$TMP/posts.jsonl"
FAILED=0
TOTAL=0
SINK_PID=""
WD=""

check() {
  local name="$1"; shift
  TOTAL=$((TOTAL + 1))
  if "$@"; then
    echo "PASS  $name"
  else
    echo "FAIL  $name"
    FAILED=$((FAILED + 1))
  fi
}

cleanup() {
  [ -n "$WD" ] && kill -TERM "$WD" 2>/dev/null
  [ -n "$SINK_PID" ] && kill "$SINK_PID" 2>/dev/null
  # Anything still running from a temp ROOT (a failed scenario's services).
  pkill -f "$TMP" 2>/dev/null
  sleep 0.5
  pkill -9 -f "$TMP" 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT

# wait_until SECONDS COMMAND...: polls every 0.2 s.
wait_until() {
  local deadline=$(( $(date +%s) + $1 )); shift
  while [ "$(date +%s)" -le "$deadline" ]; do
    "$@" && return 0
    sleep 0.2
  done
  return 1
}

free_port() {
  node -e "const s=require('net').createServer().listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})"
}

posts_matching() { grep -c -- "$1" "$POSTS" 2>/dev/null || true; }
has_posts() { [ "$(posts_matching "$1")" -ge "$2" ]; }
port_up() { curl -fsS -m 1 "http://127.0.0.1:$1/" >/dev/null 2>&1; }
port_down() { ! port_up "$1"; }
not_running() { ! kill -0 "$1" 2>/dev/null; }
file_missing() { [ ! -e "$1" ]; }
file_has() { grep -q -- "$2" "$1" 2>/dev/null; }
count_in() { grep -c -- "$2" "$1" 2>/dev/null || true; }
no_leftovers() { ! pgrep -f "$TMP/root" >/dev/null 2>&1; }

# ── fixtures ─────────────────────────────────────────────────────────────

cat >"$TMP/crash.sh" <<'EOF'
#!/usr/bin/env bash
echo "fake-crash started"
sleep 0.2
echo "fake-crash exiting with 1"
exit 1
EOF

cat >"$TMP/healthy.mjs" <<'EOF'
import http from 'node:http';
const port = Number(process.argv[2]);
http
  .createServer((_req, res) => res.end('ok'))
  .listen(port, '127.0.0.1', () => console.log(`fake-healthy up on ${port}`));
EOF

# Ignores SIGTERM, like a service hung in shutdown.
echo "process.on('SIGTERM', () => {}); setInterval(() => {}, 1 << 30);" >"$TMP/stubborn.mjs"

# Stays up doing nothing; a node script (not `sleep`) so its command line
# carries the temp path and cleanup can find it.
echo 'setInterval(() => {}, 1 << 30);' >"$TMP/stay.mjs"

node "$REPO/tests/fake-discord.mjs" "$POSTS" 0 >"$TMP/sink.out" 2>&1 &
SINK_PID=$!
wait_until 10 grep -q listening "$TMP/sink.out" || { echo "FAIL  fake Discord did not start"; exit 1; }
SINK_PORT="$(sed -n 's/^listening //p' "$TMP/sink.out")"
: >"$POSTS"

export DISCORD_CRASH_WEBHOOK_URL="http://127.0.0.1:${SINK_PORT}/hook"
export WATCHDOG_SKIP_BUILD=1 WATCHDOG_BACKOFF="0 0 0" WATCHDOG_MAX_CRASHES=3 WATCHDOG_WINDOW=60
# The posts must never fall back to a real webhook: a temp ROOT has no
# .env.local or route file, and the env var above always wins anyway.
unset DISCORD_BUG_REPORT_WEBHOOK_URL

ROOT_DIR="$TMP/root"
new_root() {
  pkill -f "$ROOT_DIR" 2>/dev/null
  rm -rf "$ROOT_DIR"
  mkdir -p "$ROOT_DIR/scripts"
  cp "$REPO/start-static.sh" "$REPO/update.sh" "$ROOT_DIR/"
  cp "$REPO/scripts/crash-report.mjs" "$ROOT_DIR/scripts/"
  : >"$POSTS"
}

start_watchdog() {
  bash "$ROOT_DIR/start-static.sh" >"$TMP/run.out" 2>&1 &
  WD=$!
}

# Collects a watchdog that should already have exited. If it has not (a failed
# check), kill it first: a bare `wait` would hang the whole test run.
reap_watchdog() {
  if kill -0 "$WD" 2>/dev/null; then
    kill -KILL "$WD" 2>/dev/null
    pkill -f "$ROOT_DIR" 2>/dev/null
  fi
  wait "$WD" 2>/dev/null
  WD=""
}

stop_and_wait() {
  local sig="$1"
  kill "-$sig" "$WD" 2>/dev/null
  wait_until 15 not_running "$WD"
  local rc=$?
  reap_watchdog
  return $rc
}

# ── 1. crash, restart, give up; healthy one untouched; SIGTERM is clean ──
echo "── crash loop and give-up"
new_root
HEALTHY_PORT="$(free_port)"
PB_FAKE_PORT="$(free_port)"
export PORT="$HEALTHY_PORT" POCKETBASE_PORT="$PB_FAKE_PORT"
export WATCHDOG_CMD_PB="exec bash '$TMP/crash.sh'"
export WATCHDOG_CMD_NEXT="exec node '$TMP/healthy.mjs' $HEALTHY_PORT"
start_watchdog
LOGS="$ROOT_DIR/logs"

check "watchdog.pid holds the watchdog's pid" wait_until 5 file_has "$LOGS/watchdog.pid" "^$WD\$"
check "ember.lock written with pid and start time" file_has "$LOGS/ember.lock" "^pid=$WD\$"
check "the crashing service gives up after 3 crashes, posting once" wait_until 20 has_posts "giving up on PocketBase" 1
sleep 2
check "each earlier crash posted (2 crash posts)" [ "$(posts_matching 'Ember: PocketBase crashed')" = 2 ]
check "exactly one give-up post" [ "$(posts_matching 'giving up on PocketBase')" = 1 ]
check "it was started 3 times and not again after giving up" [ "$(count_in "$LOGS/pocketbase.log" 'fake-crash started')" = 3 ]
check "crash posts attach the service's log tail" has_posts 'fake-crash exiting with 1' 3
check "crash post says how it exited" has_posts 'exit code 1' 3
check "the healthy service keeps running" port_up "$HEALTHY_PORT"
check "next.log has the healthy service's output" file_has "$LOGS/next.log" "fake-healthy up on $HEALTHY_PORT"
check "watchdog.log records the crashes" file_has "$LOGS/watchdog.log" "PocketBase crashed (exit code 1), crash 1 of 3"
check "service output still reaches the terminal" file_has "$TMP/run.out" "fake-healthy up on $HEALTHY_PORT"

BEFORE="$(wc -l <"$POSTS")"
check "SIGTERM stops the watchdog" stop_and_wait TERM
check "and the healthy service with it" wait_until 5 port_down "$HEALTHY_PORT"
sleep 1.5
check "no crash post for a planned stop" [ "$(wc -l <"$POSTS")" = "$BEFORE" ]
check "watchdog.pid removed on clean exit" file_missing "$LOGS/watchdog.pid"
check "ember.lock removed on clean exit" file_missing "$LOGS/ember.lock"
check "no process left behind (no orphaned restart loop)" wait_until 5 no_leftovers

# ── 2. leftover lock from a dead run, then SIGHUP ────────────────────────
echo "── unclean shutdown notice and terminal hangup"
new_root
mkdir -p "$ROOT_DIR/logs"
# A pid that cannot be alive: above the default pid_max on Linux and macOS.
printf 'pid=%s\nstarted=%s\n' 4999999 "2026-01-02 03:04:05 UTC" >"$ROOT_DIR/logs/ember.lock"
HEALTHY_PORT="$(free_port)"
export PORT="$HEALTHY_PORT"
export WATCHDOG_CMD_PB="exec node '$TMP/stay.mjs'"
export WATCHDOG_CMD_NEXT="exec node '$TMP/healthy.mjs' $HEALTHY_PORT"
start_watchdog
check "a leftover lock with a dead pid posts the unclean-shutdown notice" \
  wait_until 10 has_posts "Ember started after an unclean shutdown (machine reboot, power loss, or the process was killed)" 1
check "the notice carries the old run's start time" has_posts "2026-01-02 03:04:05 UTC" 1
check "the lock now belongs to the new run" file_has "$ROOT_DIR/logs/ember.lock" "^pid=$WD\$"
check "services come up" wait_until 10 port_up "$HEALTHY_PORT"
check "SIGHUP stops the watchdog" stop_and_wait HUP
check "SIGHUP posts the terminal-closed message" wait_until 10 has_posts \
  "Ember stopped: the terminal session closed (SIGHUP). Start it inside tmux, or with nohup, so it keeps running after you disconnect." 1
sleep 1.5
check "no crash post on hangup" [ "$(posts_matching 'crashed')" = 0 ]
check "services stopped on hangup" port_down "$HEALTHY_PORT"
check "pid and lock removed after hangup" file_missing "$ROOT_DIR/logs/ember.lock"
check "nothing left running after hangup" wait_until 5 no_leftovers

# ── 3. update.sh's stop sequence ─────────────────────────────────────────
echo "── update.sh stops the watchdog before the ports"
new_root
HEALTHY_PORT="$(free_port)"
PB_FAKE_PORT="$(free_port)"
export PORT="$HEALTHY_PORT" POCKETBASE_PORT="$PB_FAKE_PORT"
export WATCHDOG_CMD_PB="exec node '$TMP/healthy.mjs' $PB_FAKE_PORT"
export WATCHDOG_CMD_NEXT="exec node '$TMP/healthy.mjs' $HEALTHY_PORT"
start_watchdog
check "both fake services up" wait_until 10 port_up "$HEALTHY_PORT"
wait_until 10 port_up "$PB_FAKE_PORT"
UPDATE_STOP_ONLY=1 bash "$ROOT_DIR/update.sh" >"$TMP/update.out" 2>&1
check "update.sh stop sequence exits 0" [ $? = 0 ]
check "it stopped the watchdog first" file_has "$TMP/update.out" "stopping the watchdog (pid $WD)"
check "the watchdog is gone" not_running "$WD"
reap_watchdog
check "both ports are free" port_down "$HEALTHY_PORT"
check "PocketBase port free too" port_down "$PB_FAKE_PORT"
sleep 2.5
check "no crash post and no restart after update.sh's stop" [ "$(wc -l <"$POSTS" | tr -d ' ')" = 0 ]
check "update.sh leaves no pid or lock behind" file_missing "$ROOT_DIR/logs/watchdog.pid"
check "nothing restarted behind update.sh's back" no_leftovers

# ── 4. watchdog killed outright: its loops must not keep restarting ──────
echo "── SIGKILLed watchdog leaves no restart loop"
new_root
HEALTHY_PORT="$(free_port)"
export PORT="$HEALTHY_PORT"
export WATCHDOG_CMD_PB="exec node '$TMP/stay.mjs'"
export WATCHDOG_CMD_NEXT="exec node '$TMP/healthy.mjs' $HEALTHY_PORT"
start_watchdog
wait_until 10 port_up "$HEALTHY_PORT"
kill -KILL "$WD"; wait "$WD" 2>/dev/null; WD=""
# The services outlive a SIGKILLed watchdog; kill one as a crash would.
NEXT_PID="$(pgrep -f "healthy.mjs $HEALTHY_PORT" | head -1)"
kill -KILL "$NEXT_PID" 2>/dev/null
sleep 3
check "the service is not restarted once the watchdog is gone" port_down "$HEALTHY_PORT"
check "and no crash is posted for it" [ "$(posts_matching 'crashed')" = 0 ]
check "a leftover lock with a dead pid is what the next start reports" file_has "$ROOT_DIR/logs/ember.lock" "^pid="
# The other service outlived its SIGKILLed watchdog too; clear it by hand.
pkill -f "$TMP/stay.mjs" 2>/dev/null

# ── 5. a service that ignores SIGTERM is SIGKILLed after the grace period ─
echo "── stubborn service"
new_root
HEALTHY_PORT="$(free_port)"
export PORT="$HEALTHY_PORT"
export WATCHDOG_CMD_PB="exec node '$TMP/stubborn.mjs'"
export WATCHDOG_CMD_NEXT="exec node '$TMP/healthy.mjs' $HEALTHY_PORT"
start_watchdog
wait_until 10 port_up "$HEALTHY_PORT"
wait_until 10 pgrep -f "$TMP/stubborn.mjs" >/dev/null
STARTED="$(date +%s)"
check "SIGTERM still stops a watchdog whose service ignores SIGTERM" stop_and_wait TERM
check "within the 8 s grace plus a little" [ $(( $(date +%s) - STARTED )) -le 12 ]
check "the stubborn service was SIGKILLed, not left running" wait_until 3 no_leftovers
check "no crash post for it" [ "$(posts_matching 'crashed')" = 0 ]

echo
echo "$((TOTAL - FAILED))/$TOTAL passed"
[ "$FAILED" = 0 ]
