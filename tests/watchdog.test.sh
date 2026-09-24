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
    # What is still running from this run's temp dir, which is what most of
    # these checks are about one way or another. ps, not pgrep: the parent and
    # the age of a stray process are what tell you where it came from.
    # shellcheck disable=SC2009
    ps -eo pid,ppid,etime,command 2>/dev/null | grep "$TMP" | grep -v grep | sed 's/^/      still running: /'
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

# Crashes on its first 4 starts, then stays up: a service that recovers
# after the watchdog has given up on it. $1 is its start counter file.
cat >"$TMP/flaky.sh" <<'EOF'
#!/usr/bin/env bash
n=$(( $(cat "$1" 2>/dev/null || echo 0) + 1 ))
echo "$n" >"$1"
echo "fake-flaky start $n"
if [ "$n" -le 4 ]; then sleep 0.2; exit 1; fi
exec node "$2"
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

HUP_MESSAGE="Ember stopped: the terminal session closed (SIGHUP). Start it inside tmux so it keeps running after you disconnect."

ROOT_DIR="$TMP/root"
new_root() {
  pkill -f "$ROOT_DIR" 2>/dev/null
  rm -rf "$ROOT_DIR"
  mkdir -p "$ROOT_DIR/scripts"
  cp "$REPO/start-static.sh" "$REPO/update.sh" "$ROOT_DIR/"
  cp "$REPO/scripts/crash-report.mjs" "$ROOT_DIR/scripts/"
  [ -f "$REPO/scripts/read-env.mjs" ] && cp "$REPO/scripts/read-env.mjs" "$ROOT_DIR/scripts/"
  # Next (and its @next/env) for reading .env.local; start-static.sh only
  # reads from it, and rm -rf removes the link, never what it points to.
  ln -s "$REPO/node_modules" "$ROOT_DIR/node_modules"
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
STOP_STARTED="$(date +%s)"
check "SIGTERM stops the watchdog" stop_and_wait TERM
check "a stop of healthy services is prompt, not the full grace period" [ $(( $(date +%s) - STOP_STARTED )) -le 4 ]
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
  "$HUP_MESSAGE" 1
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

# ── 6. a closing SSH session: SIGHUP to the whole process group, twice ───
echo "── process-group SIGHUP, twice 50 ms apart"
new_root
HEALTHY_PORT="$(free_port)"
export PORT="$HEALTHY_PORT"
export WATCHDOG_CMD_PB="exec node '$TMP/stay.mjs'"
export WATCHDOG_CMD_NEXT="exec node '$TMP/healthy.mjs' $HEALTHY_PORT"
# Its own process group, like a job of the login shell PuTTY started; perl
# because macOS has no setsid. The exec keeps the pid, so pgid = $WD.
# shellcheck disable=SC2016  # $ARGV is perl's, not the shell's
perl -e 'setpgrp(0, 0); exec { $ARGV[0] } @ARGV' -- bash "$ROOT_DIR/start-static.sh" >"$TMP/run.out" 2>&1 &
WD=$!
check "services come up under a separate process group" wait_until 10 port_up "$HEALTHY_PORT"
wait_until 10 pgrep -f "$TMP/stay.mjs" >/dev/null
kill -HUP -- "-$WD"
sleep 0.05
kill -HUP -- "-$WD"
check "the watchdog stops" wait_until 15 not_running "$WD"
reap_watchdog
check "the terminal-closed post still arrives" wait_until 10 has_posts "$HUP_MESSAGE" 1
sleep 2
check "exactly one terminal-closed post" [ "$(posts_matching 'terminal session closed')" = 1 ]
check "no crash post from the hangup" [ "$(posts_matching 'crashed')" = 0 ]
check "the web service is stopped" port_down "$HEALTHY_PORT"
check "lock removed: a clean stop" file_missing "$ROOT_DIR/logs/ember.lock"
check "pid file removed too" file_missing "$ROOT_DIR/logs/watchdog.pid"
check "nothing left running" wait_until 5 no_leftovers

# ── 7. give up, retry quietly, post once when it is back ─────────────────
echo "── give-up, quiet retries, recovery"
new_root
HEALTHY_PORT="$(free_port)"
export PORT="$HEALTHY_PORT"
export WATCHDOG_CMD_PB="exec bash '$TMP/flaky.sh' '$TMP/flaky.count' '$TMP/stay.mjs'"
export WATCHDOG_CMD_NEXT="exec node '$TMP/healthy.mjs' $HEALTHY_PORT"
rm -f "$TMP/flaky.count"
WATCHDOG_RETRY=1 WATCHDOG_RECOVERED_AFTER=2 start_watchdog
check "gives up after 3 crashes" wait_until 20 has_posts "giving up on PocketBase" 1
check "posts once when the service stays up again" wait_until 30 has_posts "PocketBase is back up after 2 attempts" 1
sleep 1
check "the failed retry in between posted nothing (2 crash posts only)" [ "$(posts_matching 'Ember: PocketBase crashed')" = 2 ]
check "exactly one recovery post" [ "$(posts_matching 'is back up')" = 1 ]
check "one 'still retrying' line in the log" [ "$(count_in "$ROOT_DIR/logs/watchdog.log" 'still retrying every 1 min')" = 1 ]
check "started 5 times: 3 crashes, 1 failed retry, 1 that stayed up" [ "$(cat "$TMP/flaky.count")" = 5 ]
check "the other service kept running throughout" port_up "$HEALTHY_PORT"
check "SIGTERM stops it cleanly afterwards" stop_and_wait TERM
check "nothing left running after recovery and stop" wait_until 5 no_leftovers

# ── 8. update.sh stops Ember before npm ci ───────────────────────────────
echo "── update.sh stops Ember before an npm ci"
new_root
# update.sh installs into this root's node_modules: never the real one.
rm -f "$ROOT_DIR/node_modules"
HEALTHY_PORT="$(free_port)"
PB_FAKE_PORT="$(free_port)"
export PORT="$HEALTHY_PORT" POCKETBASE_PORT="$PB_FAKE_PORT"
export WATCHDOG_CMD_PB="exec node '$TMP/healthy.mjs' $PB_FAKE_PORT"
export WATCHDOG_CMD_NEXT="exec node '$TMP/healthy.mjs' $HEALTHY_PORT"
# A real git checkout with a local "origin", already up to date, and no
# node_modules, so update.sh decides an install is needed.
(
  cd "$ROOT_DIR" || exit 1
  printf 'logs/\nnode_modules/\n.node_modules.stamp\n' >.gitignore
  echo '{}' >package-lock.json
  git init -q . && git checkout -q -b main && git add -A &&
    git -c user.email=test@ember.test -c user.name=test commit -q -m init &&
    git init -q --bare "$TMP/origin.git" &&
    git remote add origin "$TMP/origin.git" && git push -q origin main
) >"$TMP/git.out" 2>&1
check "test git checkout set up" [ $? = 0 ]
# A fake npm on PATH records whether Ember was still up when the install began.
mkdir -p "$TMP/bin"
cat >"$TMP/bin/npm" <<'EOF'
#!/usr/bin/env bash
pid="$(cat logs/watchdog.pid 2>/dev/null)"
if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo "watchdog=up"; else echo "watchdog=down"; fi >"$FAKE_NPM_LOG"
if curl -fsS -m 1 "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then echo "web=up"; else echo "web=down"; fi >>"$FAKE_NPM_LOG"
mkdir -p node_modules
EOF
chmod +x "$TMP/bin/npm"
start_watchdog
check "Ember up before the update" wait_until 10 port_up "$HEALTHY_PORT"
wait_until 10 port_up "$PB_FAKE_PORT"
PATH="$TMP/bin:$PATH" FAKE_NPM_LOG="$TMP/npm.log" SKIP_YTDLP_UPGRADE=1 \
  bash "$ROOT_DIR/update.sh" --no-start >"$TMP/update.out" 2>&1
check "update.sh --no-start exits 0" [ $? = 0 ]
check "npm ci ran" file_has "$TMP/npm.log" "watchdog="
check "the watchdog was already stopped when npm ci started" file_has "$TMP/npm.log" "watchdog=down"
check "the web app was already stopped when npm ci started" file_has "$TMP/npm.log" "web=down"
check "the watchdog is gone" not_running "$WD"
reap_watchdog
sleep 2
check "no crash posts around the install" [ "$(posts_matching 'crashed')" = 0 ]
check "nothing restarted during or after the install" no_leftovers

# ── 9. PocketBase's accounts reach PocketBase only (bughunt W14) ─────────
echo "── PocketBase accounts from .env.local"
new_root
mkdir -p "$ROOT_DIR/apps/web"
cat >"$ROOT_DIR/apps/web/.env.local" <<'EOF'
POCKETBASE_ADMIN_EMAIL=su@w14.test
POCKETBASE_ADMIN_PASSWORD=Fake-Su-Pass-2026
EMBER_ADMIN_EMAIL=owner@w14.test
EMBER_ADMIN_PASSWORD="Fake-Owner-Pass-2026"
EOF
HEALTHY_PORT="$(free_port)"
export PORT="$HEALTHY_PORT"
unset EMBER_PB_SUPERUSER_EMAIL EMBER_PB_SUPERUSER_PASSWORD EMBER_ADMIN_EMAIL EMBER_ADMIN_PASSWORD POCKETBASE_ADMIN_EMAIL POCKETBASE_ADMIN_PASSWORD
export WATCHDOG_CMD_PB="env | grep '^EMBER_' | sort >'$TMP/pb.env'; exec node '$TMP/stay.mjs'"
export WATCHDOG_CMD_NEXT="env | grep '^EMBER_' | sort >'$TMP/next.env'; exec node '$TMP/healthy.mjs' $HEALTHY_PORT"
start_watchdog
check "services come up" wait_until 10 port_up "$HEALTHY_PORT"
check "PocketBase gets the superuser from the app's POCKETBASE_ADMIN_*" \
  wait_until 5 grep -qsx 'EMBER_PB_SUPERUSER_PASSWORD=Fake-Su-Pass-2026' "$TMP/pb.env"
check "and the superuser email" grep -qsx 'EMBER_PB_SUPERUSER_EMAIL=su@w14.test' "$TMP/pb.env"
check "PocketBase gets the owner account (quotes stripped)" grep -qsx 'EMBER_ADMIN_PASSWORD=Fake-Owner-Pass-2026' "$TMP/pb.env"
check "Next gets none of them" sh -c "[ -f '$TMP/next.env' ] && [ ! -s '$TMP/next.env' ]"
check "no password on any command line" sh -c "! ps -eo command | grep -v grep | grep -q 'Fake-Su-Pass-2026'"
check "SIGTERM stops it" stop_and_wait TERM

new_root
mkdir -p "$ROOT_DIR/apps/web"
printf 'POCKETBASE_ADMIN_EMAIL=su@w14.test\nPOCKETBASE_ADMIN_PASSWORD=Fake-Su-Pass-2026\n' >"$ROOT_DIR/apps/web/.env.local"
rm -f "$TMP/pb.env"
export EMBER_PB_SUPERUSER_PASSWORD="Exported-Pass-2026"
start_watchdog
check "an exported EMBER_PB_SUPERUSER_PASSWORD wins over .env.local" \
  wait_until 10 grep -qsx 'EMBER_PB_SUPERUSER_PASSWORD=Exported-Pass-2026' "$TMP/pb.env"
check "SIGTERM stops it" stop_and_wait TERM
unset EMBER_PB_SUPERUSER_PASSWORD

new_root
rm -f "$TMP/pb.env"
start_watchdog
check "with nothing configured it warns and still starts" wait_until 10 file_has "$TMP/run.out" "POCKETBASE_ADMIN_PASSWORD are not set"
check "PocketBase gets empty values (its hooks then change nothing)" \
  wait_until 5 grep -qsx 'EMBER_PB_SUPERUSER_PASSWORD=' "$TMP/pb.env"
check "SIGTERM stops it" stop_and_wait TERM
check "nothing left running" wait_until 5 no_leftovers

# ── 10. PocketBase and Next read .env.local the same way (bughunt O3) ────
echo "── one .env.local parser for PocketBase and the web app"
# What `next start` itself does with apps/web/.env* (next/dist/server/config.js
# calls loadEnvConfig(dir, false)): the fake Next records the value it would
# see, the fake PocketBase the one start-static.sh handed it.
cat >"$TMP/next-env.mjs" <<'EOF'
import { createRequire } from 'node:module';
import path from 'node:path';
const dir = path.resolve(process.argv[2]);
const key = process.argv[3];
const next = createRequire(path.join(dir, 'package.json')).resolve('next/package.json');
const { loadEnvConfig } = createRequire(next)('@next/env');
loadEnvConfig(dir, false, { info() {}, error() {} });
process.stdout.write(process.env[key] ?? '');
EOF
HEALTHY_PORT="$(free_port)"
export PORT="$HEALTHY_PORT"
unset EMBER_PB_SUPERUSER_EMAIL EMBER_PB_SUPERUSER_PASSWORD EMBER_ADMIN_EMAIL EMBER_ADMIN_PASSWORD POCKETBASE_ADMIN_EMAIL POCKETBASE_ADMIN_PASSWORD
# shellcheck disable=SC2016  # expanded by the service's own bash -c
export WATCHDOG_CMD_PB='printf %s "$EMBER_PB_SUPERUSER_PASSWORD" >"$O3_PB"; exec node "$O3_STAY"'
# shellcheck disable=SC2016
export WATCHDOG_CMD_NEXT='node "$O3_NEXT_ENV" apps/web POCKETBASE_ADMIN_PASSWORD >"$O3_NEXT"; exec node "$O3_HEALTHY" "$PORT"'
export O3_PB="$TMP/o3-pb.val" O3_NEXT="$TMP/o3-next.val" O3_STAY="$TMP/stay.mjs" O3_HEALTHY="$TMP/healthy.mjs" O3_NEXT_ENV="$TMP/next-env.mjs"
same_password() { [ -s "$O3_NEXT" ] && cmp -s "$O3_PB" "$O3_NEXT"; }
not_printed() { [ -n "$1" ] && ! grep -qF -- "$1" "$TMP/run.out" "$ROOT_DIR/logs/watchdog.log"; }
# Each case: a name, the line(s) for .env.local, and optionally for .env.
o3_case() {
  local name="$1" local_env="$2" base_env="${3:-}" secret
  new_root
  mkdir -p "$ROOT_DIR/apps/web"
  printf 'POCKETBASE_ADMIN_EMAIL=su@o3.test\n%s\n' "$local_env" >"$ROOT_DIR/apps/web/.env.local"
  [ -n "$base_env" ] && printf '%s\n' "$base_env" >"$ROOT_DIR/apps/web/.env"
  rm -f "$O3_PB" "$O3_NEXT"
  start_watchdog
  wait_until 10 port_up "$HEALTHY_PORT"
  wait_until 5 test -f "$O3_PB"
  check "$name: PocketBase gets the password the web app sees" same_password
  secret="$(cat "$O3_NEXT" 2>/dev/null)"
  check "$name: the password is not printed" not_printed "$secret"
  stop_and_wait TERM
}
# shellcheck disable=SC2016
o3_case 'a $ and a # in the value' 'POCKETBASE_ADMIN_PASSWORD=Xy7$abc#def"q'
check "a \$ that shortens the password is pointed out" file_has "$TMP/run.out" "not exactly the text after the ="
o3_case 'double quotes around a #' 'POCKETBASE_ADMIN_PASSWORD="Pass # word 2026"'
o3_case 'a trailing comment' 'POCKETBASE_ADMIN_PASSWORD=Plain-Pass-2026 # set on the host'
o3_case 'an export prefix' 'export POCKETBASE_ADMIN_PASSWORD=Exported-Line-2026'
# shellcheck disable=SC2016
o3_case 'single quotes around a $' "POCKETBASE_ADMIN_PASSWORD='Lit\$eral-2026'"
o3_case 'only in apps/web/.env' 'EMBER_UNRELATED=1' 'POCKETBASE_ADMIN_PASSWORD=From-Dot-Env-2026'
unset O3_PB O3_NEXT

# Without Next installed (a fresh clone before npm ci) the simple reader is
# the fallback, and it says so rather than quietly guessing.
new_root
rm -f "$ROOT_DIR/node_modules"
mkdir -p "$ROOT_DIR/apps/web"
printf 'POCKETBASE_ADMIN_EMAIL=su@o3.test\nPOCKETBASE_ADMIN_PASSWORD=Simple-Pass-2026\n' >"$ROOT_DIR/apps/web/.env.local"
export WATCHDOG_CMD_PB="env | grep '^EMBER_PB' | sort >'$TMP/pb.env'; exec node '$TMP/stay.mjs'"
export WATCHDOG_CMD_NEXT="exec node '$TMP/healthy.mjs' $HEALTHY_PORT"
rm -f "$TMP/pb.env"
start_watchdog
check "without Next installed it still starts" wait_until 10 port_up "$HEALTHY_PORT"
check "and warns that it used the simple reader" file_has "$TMP/run.out" "simple reader"
check "a plain password still reaches PocketBase" \
  wait_until 5 grep -qsx 'EMBER_PB_SUPERUSER_PASSWORD=Simple-Pass-2026' "$TMP/pb.env"
check "SIGTERM stops it" stop_and_wait TERM
check "nothing left running" wait_until 5 no_leftovers

echo
echo "$((TOTAL - FAILED))/$TOTAL passed"
[ "$FAILED" = 0 ]
