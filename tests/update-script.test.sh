#!/usr/bin/env bash
#
# update.sh end to end, against fake tools, in a temp dir.
#
#   bash tests/update-script.test.sh   # or: npm run test:update-script
#
# Each scenario makes a throwaway "host": a git clone of a local bare
# "origin" holding this repo's update.sh, start-static.sh and scripts, with
# a plain fake node_modules (never a link to the real one: update.sh moves
# and deletes it). npm, npx and tmux are fakes on PATH that record their
# calls; PocketBase and Next are tiny node servers on random free ports
# (WATCHDOG_CMD_PB / WATCHDOG_CMD_NEXT); Discord is tests/fake-discord.mjs.
# Nothing here touches the real checkout, its logs, .env.local or any fixed
# port. Prints PASS/FAIL per check and exits non-zero if any failed.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/update-test.XXXXXX")"
POSTS="$TMP/posts.jsonl"
FAILED=0
TOTAL=0
SINK_PID=""
UPD=""

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
  [ -n "$SINK_PID" ] && kill "$SINK_PID" 2>/dev/null
  pkill -f "$TMP" 2>/dev/null
  sleep 0.5
  pkill -9 -f "$TMP" 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT

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
port_up() { curl -fsS -m 1 "http://127.0.0.1:$1/" >/dev/null 2>&1; }
port_down() { ! port_up "$1"; }
not_running() { ! kill -0 "$1" 2>/dev/null; }
file_has() { grep -q -- "$2" "$1" 2>/dev/null; }
file_lacks() { ! grep -q -- "$2" "$1" 2>/dev/null; }
served() { [ "$(curl -fsS -m 1 "http://127.0.0.1:$1/" 2>/dev/null)" = "$2" ]; }
watchdog_pid() { tr -dc '0-9' 2>/dev/null <"$HOST/logs/watchdog.pid"; }
watchdog_up() { local p; p="$(watchdog_pid)"; [ -n "$p" ] && kill -0 "$p" 2>/dev/null; }
watchdog_is_update() { [ "$(watchdog_pid)" = "$UPD" ]; }
head_is() { [ "$(git -C "$HOST" rev-parse HEAD)" = "$1" ]; }

# ── fixtures ─────────────────────────────────────────────────────────────

# A fake service that answers with the build it serves: the BUILD_ID in
# apps/web/.next (for Next), or "pb" (for PocketBase).
cat >"$TMP/serve.mjs" <<'EOF'
import http from 'node:http';
import fs from 'node:fs';
const [port, buildFile] = process.argv.slice(2);
const body = () => (buildFile ? (fs.existsSync(buildFile) ? fs.readFileSync(buildFile, 'utf8').trim() : 'no-build') : 'pb');
http.createServer((_q, r) => r.end(body())).listen(Number(port), '127.0.0.1');
EOF

mkdir -p "$TMP/bin"
# npm: records the call and whether Ember was up; fails when FAKE_NPM_FAIL=1.
cat >"$TMP/bin/npm" <<'EOF'
#!/usr/bin/env bash
if curl -fsS -m 1 "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then up=web-up; else up=web-down; fi
echo "npm $* ($up)" >>"$FAKE_LOG"
if [ "${FAKE_NPM_FAIL:-0}" = 1 ]; then
  echo "npm ERR! network ETIMEDOUT"
  mkdir -p node_modules && echo half >node_modules/partial
  exit 1
fi
mkdir -p node_modules && echo "$(git hash-object package-lock.json)" >node_modules/installed-from
EOF
# npx: `npx next build` writes a new BUILD_ID the way next build does (the
# old output is wiped first); fails half way when FAKE_BUILD_FAIL=1.
cat >"$TMP/bin/npx" <<'EOF'
#!/usr/bin/env bash
if curl -fsS -m 1 "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then up=web-up; else up=web-down; fi
echo "npx $* ($up)" >>"$FAKE_LOG"
if [ "$1 $2" = "next build" ]; then
  mkdir -p .next && find .next -mindepth 1 -maxdepth 1 ! -name cache -exec rm -rf {} +
  if [ "${FAKE_BUILD_FAIL:-0}" = 1 ]; then echo "Type error: Build failed"; exit 1; fi
  git rev-parse --short HEAD >.next/BUILD_ID
fi
EOF
# tmux: records the call; new-session / new-window run the command detached
# in a process group of its own, as the tmux server would.
cat >"$TMP/bin/tmux" <<'EOF'
#!/usr/bin/env bash
echo "tmux $*" >>"$FAKE_LOG"
case "$1" in
  has-session) [ -f "$FAKE_TMUX_SESSION" ]; exit ;;
  new-session|new-window)
    shift; dir="$PWD"; cmd=""
    while [ $# -gt 0 ]; do
      case "$1" in -d) shift ;; -s|-t|-n) shift 2 ;; -c) dir="$2"; shift 2 ;; *) cmd="$1"; shift ;; esac
    done
    touch "$FAKE_TMUX_SESSION"
    cd "$dir" || exit 1
    # shellcheck disable=SC2016
    perl -e 'setpgrp(0, 0); exec { $ARGV[0] } @ARGV' -- sh -c "$cmd" </dev/null >>"$FAKE_TMUX_OUT" 2>&1 &
    exit 0 ;;
esac
exit 0
EOF
# systemctl --user: is-active answers from a flag file; start runs the
# unit's command the way systemd would (see unit_command), detached.
cat >"$TMP/bin/systemctl" <<'EOF'
#!/usr/bin/env bash
echo "systemctl $*" >>"$FAKE_LOG"
[ "$1" = --user ] && shift
case "$1" in
  is-active) [ -f "$FAKE_SYSTEMD_ACTIVE" ]; exit ;;
  start|restart)
    cd "$FAKE_UNIT_DIR" || exit 1
    # shellcheck disable=SC2086,SC2016
    perl -e 'setpgrp(0, 0); exec { $ARGV[0] } @ARGV' -- $FAKE_UNIT_EXEC </dev/null >>"$FAKE_TMUX_OUT" 2>&1 &
    touch "$FAKE_SYSTEMD_ACTIVE"
    exit 0 ;;
esac
exit 0
EOF
chmod +x "$TMP/bin/"*
# A directory with the fakes but no tmux, for a host without it.
mkdir -p "$TMP/bin-notmux"
cp "$TMP/bin/npm" "$TMP/bin/npx" "$TMP/bin/systemctl" "$TMP/bin-notmux/"

node "$REPO/tests/fake-discord.mjs" "$POSTS" 0 >"$TMP/sink.out" 2>&1 &
SINK_PID=$!
wait_until 10 grep -q listening "$TMP/sink.out" || { echo "FAIL  fake Discord did not start"; exit 1; }
SINK_PORT="$(sed -n 's/^listening //p' "$TMP/sink.out")"
export DISCORD_CRASH_WEBHOOK_URL="http://127.0.0.1:${SINK_PORT}/hook"
unset DISCORD_BUG_REPORT_WEBHOOK_URL TMUX STY
export WATCHDOG_BACKOFF="0 0 0" WATCHDOG_MAX_CRASHES=3 WATCHDOG_WINDOW=60 SKIP_YTDLP_UPGRADE=1
export FAKE_LOG="$TMP/fake.log" FAKE_TMUX_SESSION="$TMP/tmux.session" FAKE_TMUX_OUT="$TMP/tmux.out"
export FAKE_SYSTEMD_ACTIVE="$TMP/systemd.active"
BASE_PATH="$PATH"

HOST="$TMP/host"
ORIGIN="$TMP/origin.git"
# new_host: origin + a host clone at commit "v1" with a finished v1 build and
# installed node_modules, then a "v2" commit on origin (NEW_LOCK=1: v2 also
# changes package-lock.json, so update.sh must install). Ember is not running.
new_host() {
  pkill -f "$TMP/host" 2>/dev/null
  pkill -f "$TMP/serve.mjs" 2>/dev/null
  sleep 0.3
  rm -rf "$HOST" "$ORIGIN" "$TMP/seed" "$FAKE_TMUX_SESSION" "$FAKE_SYSTEMD_ACTIVE"
  : >"$FAKE_LOG"; : >"$FAKE_TMUX_OUT"; : >"$POSTS"
  mkdir -p "$TMP/seed/scripts" "$TMP/seed/apps/web"
  cp "$REPO/start-static.sh" "$REPO/update.sh" "$TMP/seed/"
  cp "$REPO/scripts/crash-report.mjs" "$TMP/seed/scripts/"
  [ -f "$REPO/scripts/read-env.mjs" ] && cp "$REPO/scripts/read-env.mjs" "$TMP/seed/scripts/"
  echo '{"name":"web","version":"0.0.1"}' >"$TMP/seed/apps/web/package.json"
  echo '{"lock":1}' >"$TMP/seed/package-lock.json"
  printf 'logs/\nnode_modules/\n.node_modules.stamp\n.next/\n*.update-prev/\n' >"$TMP/seed/.gitignore"
  (
    cd "$TMP/seed" || exit 1
    git init -q . && git checkout -q -b main && git add -A &&
      git -c user.email=t@ember.test -c user.name=t commit -q -m v1 &&
      git init -q --bare "$ORIGIN" && git remote add origin "$ORIGIN" && git push -q origin main &&
      git clone -q "$ORIGIN" "$HOST"
  ) >"$TMP/git.out" 2>&1 || { echo "FAIL  test git setup"; cat "$TMP/git.out"; exit 1; }
  V1="$(git -C "$HOST" rev-parse HEAD)"
  mkdir -p "$HOST/node_modules" "$HOST/apps/web/.next/cache"
  echo v1-deps >"$HOST/node_modules/installed-from"
  git -C "$HOST" hash-object package-lock.json >"$HOST/.node_modules.stamp"
  git -C "$HOST" rev-parse --short HEAD >"$HOST/apps/web/.next/BUILD_ID"
  echo warm >"$HOST/apps/web/.next/cache/webpack"
  (
    cd "$TMP/seed" || exit 1
    echo "v2" >CHANGES
    [ "${NEW_LOCK:-0}" = 1 ] && echo '{"lock":2}' >package-lock.json
    git add -A && git -c user.email=t@ember.test -c user.name=t commit -q -m v2 && git push -q origin main
  ) >>"$TMP/git.out" 2>&1
  V2="$(git -C "$ORIGIN" rev-parse main)"
  V1_SHORT="$(git -C "$HOST" rev-parse --short "$V1")"
  V2_SHORT="$(git -C "$ORIGIN" rev-parse --short "$V2")"
}

WEB_PORT="$(free_port)"
PB_PORT="$(free_port)"
export PORT="$WEB_PORT" POCKETBASE_PORT="$PB_PORT"
export WATCHDOG_CMD_PB="exec node '$TMP/serve.mjs' $PB_PORT"
export WATCHDOG_CMD_NEXT="exec node '$TMP/serve.mjs' $WEB_PORT apps/web/.next/BUILD_ID"

# start_ember: the host's Ember as the owner runs it today, with its v1 build.
start_ember() {
  ( cd "$HOST" && WATCHDOG_SKIP_BUILD=1 exec bash ./start-static.sh ) >"$TMP/ember.out" 2>&1 &
  wait_until 10 port_up "$WEB_PORT" && wait_until 10 port_up "$PB_PORT"
}

# run_update ARGS...: ./update.sh in its own process group, like a job of
# the SSH login shell, in the background. UPD is its pid (= the group id).
run_update() {
  # shellcheck disable=SC2016
  ( cd "$HOST" && exec perl -e 'setpgrp(0, 0); exec { $ARGV[0] } @ARGV' -- bash ./update.sh "$@" ) \
    </dev/null >"$TMP/update.out" 2>&1 &
  UPD=$!
}
update_returned() { wait_until "$1" not_running "$UPD"; }
# Collects its exit status into UPD_RC (a `wait` in $(...) could not).
# A run that is still going (a failed check) reads as "running", never waited on.
reap_update() {
  if kill -0 "$UPD" 2>/dev/null; then UPD_RC=running; return; fi
  wait "$UPD" 2>/dev/null; UPD_RC=$?
}
# The SSH window closes: SIGHUP to the update's whole process group.
close_terminal() { kill -HUP -- "-$UPD" 2>/dev/null; }

stop_ember() {
  local p; p="$(watchdog_pid)"
  [ -n "$p" ] && kill -TERM "$p" 2>/dev/null && wait_until 20 not_running "$p"
  [ -n "$UPD" ] && { kill -KILL "$UPD" 2>/dev/null; wait "$UPD" 2>/dev/null; }
  UPD=""
  pkill -f "$TMP/host" 2>/dev/null
  pkill -f "$TMP/serve.mjs" 2>/dev/null
  true
}

# ── 1. run from a plain SSH shell: Ember moves into tmux (bughunt O2) ─────
echo "── update from outside tmux"
new_host
PATH="$TMP/bin:$BASE_PATH"
start_ember
OLD_WD="$(watchdog_pid)"
run_update
check "update.sh finishes instead of keeping Ember in this terminal" update_returned 40
reap_update
check "and exits 0" [ "$UPD_RC" = 0 ]
check "it started Ember in a detached tmux session named ember" file_has "$FAKE_LOG" "tmux new-session -d -s ember"
check "it tells the owner how to look at it" file_has "$TMP/update.out" "tmux attach -t ember"
check "the new watchdog is running" watchdog_up
check "the update was applied" head_is "$V2"
close_terminal
sleep 2
check "closing the SSH window does not stop Ember" served "$WEB_PORT" "$V2_SHORT"
check "the watchdog is still running after the hangup" watchdog_up
check "no terminal-closed post" [ "$(posts_matching 'terminal session closed')" = 0 ]
check "the old watchdog was replaced" [ "$(watchdog_pid)" != "$OLD_WD" ]
stop_ember

# An ember session is already there (the owner's old tmux window): a new
# window in it, not a second session.
new_host
PATH="$TMP/bin:$BASE_PATH"
touch "$FAKE_TMUX_SESSION"
start_ember
run_update
check "with a session already there: update.sh finishes" update_returned 40
check "it opens a new window in the ember session" file_has "$FAKE_LOG" "tmux new-window -t ember"
check "and no second session" file_lacks "$FAKE_LOG" "new-session"
check "Ember runs the new version" wait_until 10 served "$WEB_PORT" "$V2_SHORT"
stop_ember

# ── 2. run inside tmux: unchanged, Ember stays in this window ───────────
echo "── update inside tmux"
new_host
PATH="$TMP/bin:$BASE_PATH"
start_ember
TMUX="/tmp/fake-tmux-socket,1,0" run_update
check "inside tmux, update.sh becomes the watchdog in this window" wait_until 40 watchdog_is_update
check "no new tmux session" file_lacks "$FAKE_LOG" "tmux new"
check "Ember serves the new version" wait_until 10 served "$WEB_PORT" "$V2_SHORT"
stop_ember

# ── 3. no tmux on the host: refuse before touching anything ─────────────
echo "── no tmux installed"
new_host
PATH="$TMP/bin-notmux:$BASE_PATH"
start_ember
OLD_WD="$(watchdog_pid)"
run_update
check "without tmux, update.sh refuses" update_returned 20
reap_update
check "with exit 1" [ "$UPD_RC" = 1 ]
check "saying how to install it" file_has "$TMP/update.out" "sudo apt install tmux"
check "and naming --here" file_has "$TMP/update.out" "./update.sh --here"
check "nothing was pulled" head_is "$V1"
check "the running Ember was left alone" [ "$(watchdog_pid)" = "$OLD_WD" ]
check "and still serves" served "$WEB_PORT" "$V1_SHORT"
stop_ember

new_host
PATH="$TMP/bin-notmux:$BASE_PATH"
start_ember
run_update --here
check "--here updates and keeps Ember in this window" wait_until 40 watchdog_is_update
check "--here serves the new version" wait_until 10 served "$WEB_PORT" "$V2_SHORT"
stop_ember

# ── 4. deploy/ember.service runs Ember (bughunt O6) ─────────────────────
echo "── the systemd unit"
UNIT="$REPO/deploy/ember.service"
unit_value() { sed -n "s/^$1=//p" "$UNIT" | tail -1; }
UNIT_WD="$(unit_value WorkingDirectory)"
# The unit's command with its Ember folder mapped onto the test host.
unit_command() { local e; e="$(unit_value ExecStart)"; printf '%s' "${e//$UNIT_WD/$HOST}"; }
unit_paths_exist() {
  local w
  for w in $(unit_command); do
    case "$w" in
      /*) [ -e "$w" ] || return 1 ;;
      */*) [ -e "$HOST/$w" ] || return 1 ;;
    esac
  done
}
STOP_GRACE="$(sed -n 's/^STOP_GRACE=//p' "$REPO/start-static.sh")"
TIMEOUT_STOP="$(unit_value TimeoutStopSec)"
new_host
check "the unit runs start-static.sh" file_has "$UNIT" "^ExecStart=.*start-static.sh"
check "every file its command names exists" unit_paths_exist
check "systemd stops only the watchdog, which stops the services (KillMode=mixed)" file_has "$UNIT" "^KillMode=mixed$"
# The watchdog's worst case: both services ignore SIGTERM, each supervisor
# waits STOP_GRACE + 6 s, one after the other.
check "TimeoutStopSec leaves the watchdog its whole grace ($TIMEOUT_STOP s > 2 x $((STOP_GRACE + 6)) s)" \
  [ "${TIMEOUT_STOP:-0}" -gt $(( 2 * (STOP_GRACE + 6) )) ]
check "no leftover of the old API server" file_lacks "$UNIT" "apps/api"

# Start it the way systemd does (in the unit's folder, a process group of
# its own) and stop it the way KillMode=mixed does: SIGTERM to the main pid.
PATH="$TMP/bin:$BASE_PATH"
# shellcheck disable=SC2016,SC2046
( cd "$HOST" && exec perl -e 'setpgrp(0, 0); exec { $ARGV[0] } @ARGV or exit 127' -- $(unit_command) ) </dev/null >"$TMP/unit.out" 2>&1 &
UNIT_PID=$!
check "the unit's command brings Ember up" wait_until 20 port_up "$WEB_PORT"
check "its main process is the watchdog" wait_until 5 sh -c "[ \"\$(tr -dc 0-9 2>/dev/null <'$HOST/logs/watchdog.pid')\" = '$UNIT_PID' ]"
STARTED="$(date +%s)"
kill -TERM "$UNIT_PID" 2>/dev/null
check "SIGTERM to the main process stops everything within TimeoutStopSec" wait_until "${TIMEOUT_STOP:-1}" not_running "$UNIT_PID"
wait "$UNIT_PID" 2>/dev/null
UNIT_RC=$?
check "and it exits 0, so Restart=on-failure does not restart it" [ "$UNIT_RC" = 0 ]
check "within TimeoutStopSec" [ $(( $(date +%s) - STARTED )) -le "${TIMEOUT_STOP:-0}" ]
check "the web app is stopped" port_down "$WEB_PORT"
check "PocketBase is stopped" port_down "$PB_PORT"
check "a clean stop: no lock left" sh -c "[ ! -e '$HOST/logs/ember.lock' ]"
check "no crash post" [ "$(posts_matching 'crashed')" = 0 ]
stop_ember

# ./update.sh on a host where systemd runs Ember: back through systemd, not
# tmux, and no tmux needed.
new_host
PATH="$TMP/bin-notmux:$BASE_PATH"
export FAKE_UNIT_DIR="$HOST" FAKE_UNIT_EXEC
FAKE_UNIT_EXEC="$(unit_command)"
start_ember
touch "$FAKE_SYSTEMD_ACTIVE"
run_update
check "under systemd, update.sh needs no tmux and finishes" update_returned 40
reap_update
check "and exits 0" [ "$UPD_RC" = 0 ]
check "it restarts Ember through systemd" file_has "$FAKE_LOG" "systemctl --user start ember"
check "not in tmux" file_lacks "$FAKE_LOG" "tmux new"
check "Ember serves the new version" wait_until 20 served "$WEB_PORT" "$V2_SHORT"
check "it says how to check on it" file_has "$TMP/update.out" "systemctl --user status ember"
stop_ember

echo
echo "$((TOTAL - FAILED))/$TOTAL passed"
[ "$FAILED" = 0 ]
