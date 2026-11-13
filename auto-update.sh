#!/usr/bin/env bash
#
# Run by the ember-auto-update timer (see install-auto-update.sh and SETUP.md,
# "Automatic updates"): if origin/main has new commits, run ./update.sh.
# Safe to run by hand. A run that finds nothing new does nothing, quietly.
#
# It only updates when it is safe:
#   - no other update is running (shares logs/.update.lock with update.sh)
#   - this checkout has no local commits
#   - the only locally edited tracked file, if any, is a package-lock.json
#     (npm rewrites it on the host); that one is put back. Anything else is
#     someone's work: refused.
#   - Ember can come back by itself afterwards: through systemd
#     (ember.service) or in a tmux session. update.sh would otherwise
#     restart it in the foreground, which a timer cannot do, so it refuses.
#
# A refusal, or an update.sh that fails, is posted to Discord ONCE per reason
# and commit (scripts/crash-report.mjs, the webhook the host already has for
# crash reports), not every 5 minutes. Output of the last run: logs/auto-update.log.
#
# Test-only overrides: EMBER_UPDATE_CMD (instead of ./update.sh),
# EMBER_PUBLIC_URL, EMBER_AUTO_UPDATE_SKIP_RELAUNCH_CHECK=1.

set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT" || exit 1

UPDATE_CMD="${EMBER_UPDATE_CMD:-$ROOT/update.sh}"
PUBLIC_URL="${EMBER_PUBLIC_URL:-https://github.com/ParalelSt/ember.git}"
LOCK="$ROOT/logs/.update.lock"
LOG="$ROOT/logs/auto-update.log"
STATE="$ROOT/logs/.auto-update-reported"
# Files npm rewrites on its own, safe to put back.
NPM_FILES="package-lock.json apps/web/package-lock.json"

mkdir -p "$ROOT/logs"
: >"$LOG"
say() { echo "$*" | tee -a "$LOG"; }

# Another update (this timer's earlier run, or ./update.sh by hand) running:
# skip, quietly. update.sh takes the lock itself, so a race between the two
# ends with one of them refusing.
if [ -d "$LOCK" ]; then
  owner="$(tr -dc '0-9' 2>/dev/null <"$LOCK/pid" || true)"
  if [ -z "$(find "$LOCK" -maxdepth 0 -mmin +60 2>/dev/null)" ] \
     && [ -n "$owner" ] && kill -0 "$owner" 2>/dev/null; then
    echo "Another update is running; skipping."
    exit 0
  fi
fi

# refuse REASON COMMIT: say why (already in the log), tell Discord once, exit 1.
refuse() {
  local reason="$1" commit="$2" key
  key="$reason @ $commit"
  if [ "$(cat "$STATE" 2>/dev/null || true)" != "$key" ]; then
    echo "$key" >"$STATE"
    command -v node >/dev/null 2>&1 && [ -f "$ROOT/scripts/crash-report.mjs" ] && \
      node "$ROOT/scripts/crash-report.mjs" --title "Ember auto-update: $reason" \
        --text "The host did not update itself ($reason). It will not report this again until the reason or the new commit changes." \
        --log "$LOG" --lines 20 >/dev/null 2>&1
  fi
  exit 1
}

# ── look at GitHub ────────────────────────────────────────────────────────
remote_url="$(git remote get-url origin 2>/dev/null || true)"
# Never let a password in a remote URL reach the log, and so Discord.
no_creds() { sed -E 's#(://)[^/@ ]+@#\1#g'; }
remote_url_safe="$(echo "$remote_url" | no_creds)"
# fetch_into_log ARGS...: git fetch, its complaints (scrubbed) into the log.
fetch_into_log() {
  local err rc
  err="$(git fetch --quiet "$@" 2>&1)"; rc=$?
  if [ -n "$err" ]; then echo "$err" | no_creds >>"$LOG"; fi
  return $rc
}
if fetch_into_log origin main; then
  remote_rev="$(git rev-parse origin/main)"
else
  say "git fetch origin failed (origin is ${remote_url_safe})."
  if echo "$remote_url" | grep -Eq '^(ssh://|[A-Za-z0-9._-]+@[^/]+:)|://[^/@]+@'; then
    # An SSH or credentialed origin: see whether the public URL works.
    if fetch_into_log "$PUBLIC_URL" main; then
      remote_rev="$(git rev-parse FETCH_HEAD)"
      if [ "$remote_rev" = "$(git rev-parse HEAD)" ]; then exit 0; fi
      say "The public URL works but origin does not, and update.sh uses origin."
      say "Switch it by running: ./install-auto-update.sh"
      refuse "origin cannot be fetched (SSH or credentials); switch it to the public URL" "$remote_rev"
    fi
  fi
  refuse "cannot reach GitHub" "none"
fi

local_rev="$(git rev-parse HEAD)"
if [ "$local_rev" = "$remote_rev" ]; then
  rm -f "$STATE"
  exit 0
fi

if ! git merge-base --is-ancestor HEAD origin/main; then
  say "Not updating: this checkout has commits that are not on origin/main."
  say "Ember only auto-updates a checkout that follows main exactly."
  refuse "local commits not on origin/main" "$remote_rev"
fi

# Tracked edits: put back the ones npm makes, refuse on any other.
changed="$(git diff --name-only HEAD)"
if [ -n "$changed" ]; then
  other=""
  for f in $changed; do
    case " $NPM_FILES " in *" $f "*) ;; *) other="$other $f" ;; esac
  done
  if [ -n "$other" ]; then
    say "Not updating: tracked files have local changes:"
    for f in $other; do say "    $f"; done
    say "If you did not edit them by hand, put them back with: git checkout -- <file>"
    refuse "local edits to tracked files:$other" "$remote_rev"
  fi
  say "Restoring $(echo "$changed" | tr '\n' ' ')(npm rewrote it on the host)."
  # shellcheck disable=SC2086
  git checkout -- $changed
fi

# update.sh's own relaunch choice, minus the cases that need a terminal.
# A timer has no TTY and no TMUX, so it lands in systemd, else tmux, else the
# foreground (and would then stop Ember with nothing to bring it back).
if [ "${EMBER_AUTO_UPDATE_SKIP_RELAUNCH_CHECK:-0}" != 1 ]; then
  relaunch=""
  if command -v systemctl >/dev/null 2>&1 \
     && { systemctl --user is-active --quiet ember.service 2>/dev/null \
          || systemctl --user is-failed --quiet ember.service 2>/dev/null; }; then
    relaunch="systemd"
  elif command -v tmux >/dev/null 2>&1; then
    relaunch="tmux"
  fi
  if [ -z "$relaunch" ]; then
    say "Not updating: Ember could not be restarted without a terminal."
    say "Run it under systemd (SETUP.md, \"Run Ember at boot\") or install tmux: sudo apt install tmux"
    refuse "Ember has no systemd unit or tmux to restart it" "$remote_rev"
  fi
fi

say "New commits on origin/main ($(git rev-parse --short "$local_rev") -> $(git rev-parse --short "$remote_rev")); updating."
# From a timer there is no terminal; make sure a stray TMUX/STY (a hand run
# inside tmux) does not send Ember to the foreground of a window.
unset TMUX STY
"$UPDATE_CMD" >>"$LOG" 2>&1
rc=$?
cat "$LOG"
if [ "$rc" -eq 0 ]; then
  rm -f "$STATE"
  exit 0
fi
# Lost a race with a manual ./update.sh: not a failure.
if grep -q "Another update is already running" "$LOG"; then exit 0; fi
refuse "update.sh failed (exit $rc), see the log" "$remote_rev"
