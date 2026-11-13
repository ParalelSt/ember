#!/usr/bin/env bash
#
# auto-update.sh and install-auto-update.sh, end to end, in a temp dir.
#
#   bash tests/auto-update.test.sh   # or: npm run test:auto-update
#
# A throwaway bare "origin", a "host" clone of it holding this repo's
# auto-update.sh and scripts/crash-report.mjs, and a fake update.sh
# (EMBER_UPDATE_CMD) that only records that it ran. Discord is
# tests/fake-discord.mjs. systemctl, loginctl and tmux are never touched for
# real. Prints PASS/FAIL per check and exits non-zero if any failed.

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/auto-update-test.XXXXXX")"
FAILED=0
SINK_PID=""

check() {
  local name="$1"; shift
  if "$@"; then echo "PASS  $name"; else echo "FAIL  $name"; FAILED=$((FAILED + 1)); fi
}
cleanup() {
  [ -n "$SINK_PID" ] && kill "$SINK_PID" 2>/dev/null
  [ -n "${HOLDER:-}" ] && kill "$HOLDER" 2>/dev/null
  rm -rf "$TMP"
}
trap cleanup EXIT

export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_SYSTEM=/dev/null GIT_SSH_COMMAND=false
export EMBER_AUTO_UPDATE_SKIP_RELAUNCH_CHECK=1

POSTS="$TMP/posts.jsonl"
node "$REPO/tests/fake-discord.mjs" "$POSTS" 0 >"$TMP/sink.out" 2>&1 &
SINK_PID=$!
for _ in $(seq 1 50); do grep -q listening "$TMP/sink.out" && break; sleep 0.2; done
SINK_PORT="$(sed -n 's/^listening //p' "$TMP/sink.out")"
export DISCORD_CRASH_WEBHOOK_URL="http://127.0.0.1:${SINK_PORT}/hook"
unset DISCORD_BUG_REPORT_WEBHOOK_URL

ORIGIN="$TMP/origin.git"
SEED="$TMP/seed"
HOST="$TMP/host"
RAN="$TMP/update.ran"
export EMBER_PUBLIC_URL="$ORIGIN"

# A fake update.sh: records the run; FAKE_UPDATE_RC makes it fail.
cat >"$TMP/fake-update.sh" <<FAKE
#!/usr/bin/env bash
echo ran >>"$RAN"
echo "fake update output line"
exit "\${FAKE_UPDATE_RC:-0}"
FAKE
chmod +x "$TMP/fake-update.sh"
export EMBER_UPDATE_CMD="$TMP/fake-update.sh"

new_world() {
  rm -rf "$ORIGIN" "$SEED" "$HOST"; : >"$POSTS"; rm -f "$RAN"
  git init -q --bare -b main "$ORIGIN"
  git init -q -b main "$SEED"
  mkdir -p "$SEED/scripts"
  cp "$REPO/auto-update.sh" "$SEED/"
  cp "$REPO/scripts/crash-report.mjs" "$SEED/scripts/"
  printf '/logs/\n' >"$SEED/.gitignore"
  echo '{}' >"$SEED/package-lock.json"
  echo a >"$SEED/a.txt"
  git -C "$SEED" add -A && git -C "$SEED" commit -q -m first
  git -C "$SEED" remote add origin "$ORIGIN"
  git -C "$SEED" push -q origin main
  git clone -q "$ORIGIN" "$HOST"
}
push_new() { echo "$RANDOM" >"$SEED/a.txt"; git -C "$SEED" commit -q -am "new $RANDOM"; git -C "$SEED" push -q origin main; }
run_auto() { OUT="$(bash "$HOST/auto-update.sh" 2>&1)"; RC=$?; }
ran() { [ -s "$RAN" ]; }
posts() { wc -l <"$POSTS" | tr -d ' '; }
posts_are() { [ "$(posts)" = "$1" ]; }
out_has() { echo "$OUT" | grep -q -- "$1"; }
post_has() { grep -q -- "$1" "$POSTS"; }

# 1 up to date
new_world; run_auto
check "up to date: update not run" bash -c '! [ -s "'"$RAN"'" ]'
check "up to date: exit 0, quiet" bash -c '[ "'"$RC"'" = 0 ] && [ -z "'"$OUT"'" ]'

# 2 new commit
new_world; push_new; run_auto
check "new commit: update run" ran
check "new commit: exit 0" test "$RC" = 0
check "new commit: update output shown" out_has "fake update output line"

# 3 dirty tree (not an npm file): refused, reported once
new_world; push_new; echo x >>"$HOST/a.txt"; run_auto
check "dirty tree: update not run" bash -c '! [ -s "'"$RAN"'" ]'
check "dirty tree: exit 1 and names the file" bash -c '[ "'"$RC"'" = 1 ]'
check "dirty tree: message names the file" out_has "a.txt"
check "dirty tree: reported to Discord" posts_are 1
check "dirty tree: report has the reason" post_has "local edits to tracked files"
check "dirty tree: edits left alone" grep -q x "$HOST/a.txt"
run_auto
check "dirty tree: same refusal not reported again" posts_are 1

# 4 only package-lock.json dirty: restored, update runs
new_world; push_new; echo '{"x":1}' >"$HOST/package-lock.json"; run_auto
check "package-lock only: update run" ran
check "package-lock only: file restored" bash -c '[ "$(cat "'"$HOST"'/package-lock.json")" = "{}" ]'
check "package-lock only: nothing reported" posts_are 0

# 4b package-lock plus another edit: refused, lock file left as is
new_world; push_new; echo '{"x":1}' >"$HOST/package-lock.json"; echo y >>"$HOST/a.txt"; run_auto
check "lock + other edit: refused, not run" bash -c '! [ -s "'"$RAN"'" ] && [ "'"$RC"'" = 1 ]'

# 5 local-only commit
new_world; echo b >"$HOST/b.txt"; git -C "$HOST" add b.txt; git -C "$HOST" commit -q -m local
push_new; run_auto
check "local commit: update not run" bash -c '! [ -s "'"$RAN"'" ]'
check "local commit: refused and reported" bash -c '[ "'"$RC"'" = 1 ] && [ "$(wc -l <"'"$POSTS"'" | tr -d " ")" = 1 ]'

# 6 lock held by a live process: skipped; a dead owner's lock does not block
new_world; push_new
mkdir -p "$HOST/logs/.update.lock"; sleep 60 & HOLDER=$!; echo "$HOLDER" >"$HOST/logs/.update.lock/pid"
run_auto
check "lock held: update not run" bash -c '! [ -s "'"$RAN"'" ]'
check "lock held: exit 0, says skipping" bash -c '[ "'"$RC"'" = 0 ]'
check "lock held: skip message" out_has "skipping"
kill "$HOLDER" 2>/dev/null; wait "$HOLDER" 2>/dev/null; echo "$HOLDER" >"$HOST/logs/.update.lock/pid"
run_auto
check "dead owner's lock: update run" ran

# 7 origin is SSH and fails: public URL tried, refused with the fix named
new_world; push_new; git -C "$HOST" remote set-url origin "ssh://git@127.0.0.1:1/x/ember.git"; run_auto
check "ssh origin: update not run" bash -c '! [ -s "'"$RAN"'" ]'
check "ssh origin: tells to run the installer" out_has "install-auto-update.sh"
check "ssh origin: reported once" posts_are 1
check "ssh origin: no raw ssh user in log" bash -c '! grep -q "git@" "'"$HOST"'/logs/auto-update.log"'

# 7b credentialed https origin: password never in the log or report
new_world; push_new; git -C "$HOST" remote set-url origin "http://user:secretpw@127.0.0.1:1/x.git"; run_auto
check "credential origin: refused" bash -c '[ "'"$RC"'" = 1 ] && ! [ -s "'"$RAN"'" ]'
check "credential origin: password not logged or posted" bash -c '! grep -rq secretpw "'"$HOST"'/logs" && ! grep -q secretpw "'"$POSTS"'"'

# 8 GitHub unreachable, plain origin
new_world; push_new; git -C "$HOST" remote set-url origin "http://127.0.0.1:1/x.git"; run_auto
check "unreachable: refused and reported" bash -c '[ "'"$RC"'" = 1 ] && [ "$(wc -l <"'"$POSTS"'" | tr -d " ")" = 1 ]'
check "unreachable: says cannot reach" post_has "cannot reach GitHub"

# 9 update.sh fails: reported once per commit, with its output
new_world; push_new; FAKE_UPDATE_RC=3 run_auto
check "update fails: exit 1" test "$RC" = 1
check "update fails: reported with output tail" bash -c 'grep -q "fake update output line" "'"$POSTS"'" && [ "$(wc -l <"'"$POSTS"'" | tr -d " ")" = 1 ]'
FAKE_UPDATE_RC=3 run_auto
check "update fails again: not reported again" posts_are 1
push_new; FAKE_UPDATE_RC=3 run_auto
check "update fails on a newer commit: reported again" posts_are 2
run_auto
check "update works after failures: exit 0" test "$RC" = 0

# 10 no systemd unit and no tmux: refused (real relaunch check)
new_world; push_new
BIN="$TMP/bin"; rm -rf "$BIN"; mkdir "$BIN"
for t in env bash git node tr find sed cat grep mkdir rm dirname tee wc id head sleep; do
  p="$(command -v "$t")" && ln -s "$p" "$BIN/$t"
done
OUT="$(env -u EMBER_AUTO_UPDATE_SKIP_RELAUNCH_CHECK PATH="$BIN" "$(command -v bash)" "$HOST/auto-update.sh" 2>&1)"; RC=$?
check "no systemd or tmux: refused, update not run" bash -c '[ "'"$RC"'" = 1 ] && ! [ -s "'"$RAN"'" ]'
check "no systemd or tmux: says why" out_has "could not be restarted"
# ...and with a tmux on PATH it goes ahead
printf '#!/bin/sh\nexit 0\n' >"$BIN/tmux"; chmod +x "$BIN/tmux"
OUT="$(env -u EMBER_AUTO_UPDATE_SKIP_RELAUNCH_CHECK PATH="$BIN" "$(command -v bash)" "$HOST/auto-update.sh" 2>&1)"; RC=$?
check "tmux present: update run" ran

# 10b a manual ./update.sh refuses while another update holds the lock
if command -v lsof >/dev/null 2>&1; then
  new_world; cp "$REPO/update.sh" "$HOST/"; mkdir -p "$HOST/logs/.update.lock"
  sleep 60 & HOLDER=$!; echo "$HOLDER" >"$HOST/logs/.update.lock/pid"
  OUT="$(cd "$HOST" && bash ./update.sh 2>&1)"; RC=$?
  check "update.sh with lock held: refuses" bash -c '[ "'"$RC"'" = 1 ]'
  check "update.sh with lock held: says why" out_has "Another update is already running"
  kill "$HOLDER" 2>/dev/null; wait "$HOLDER" 2>/dev/null
  OUT="$(cd "$HOST" && bash ./update.sh --check 2>&1)"; RC=$?
  check "update.sh --check ignores the lock and leaves none" bash -c '[ "'"$RC"'" = 0 ]'
fi

# 11 installer
new_world
H="$TMP/home"; rm -rf "$H"; mkdir -p "$H" "$TMP/fakebin"
cat >"$TMP/fakebin/systemctl" <<FAKE
#!/bin/sh
echo "systemctl \$*" >>"$TMP/ctl.log"
exit 0
FAKE
cat >"$TMP/fakebin/loginctl" <<FAKE
#!/bin/sh
echo "loginctl \$*" >>"$TMP/ctl.log"
exit 0
FAKE
chmod +x "$TMP/fakebin/"*
cp "$REPO/install-auto-update.sh" "$HOST/"
git -C "$HOST" remote set-url origin "ssh://git@127.0.0.1:1/x/ember.git"
: >"$TMP/ctl.log"
run_install() { OUT="$(XDG_CONFIG_HOME="$H/.config" PATH="$TMP/fakebin:$PATH" bash "$HOST/install-auto-update.sh" "$@" 2>&1)"; RC=$?; }
run_install
U="$H/.config/systemd/user"
check "installer: exit 0" test "$RC" = 0
check "installer: timer 2min after boot, every 5min" bash -c 'grep -q "OnBootSec=2min" "'"$U"'/ember-auto-update.timer" && grep -q "OnUnitActiveSec=5min" "'"$U"'/ember-auto-update.timer"'
check "installer: service PATH has node dir" grep -q "Environment=PATH=$(dirname "$(command -v node)")" "$U/ember-auto-update.service"
check "installer: service runs auto-update.sh" grep -q "auto-update.sh" "$U/ember-auto-update.service"
check "installer: timer enabled and lingering on" bash -c 'grep -q "enable --now ember-auto-update.timer" "'"$TMP"'/ctl.log" && grep -q "loginctl enable-linger" "'"$TMP"'/ctl.log"'
check "installer: ssh origin switched to public URL" bash -c '[ "$(git -C "'"$HOST"'" remote get-url origin)" = "'"$ORIGIN"'" ]'
check "installer: says what it changed" out_has "Changed git remote origin"
check "installer: dry check reported" out_has "GitHub is reachable"
run_install
check "installer: idempotent" test "$RC" = 0
run_install --off
check "installer --off: files removed" bash -c '! [ -e "'"$U"'/ember-auto-update.timer" ] && ! [ -e "'"$U"'/ember-auto-update.service" ]'

echo
if [ "$FAILED" = 0 ]; then echo "all checks passed"; else echo "$FAILED check(s) FAILED"; exit 1; fi
