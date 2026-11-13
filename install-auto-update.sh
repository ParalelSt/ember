#!/usr/bin/env bash
#
# One-time: makes this Ember host update itself. A systemd USER timer checks
# GitHub 2 minutes after boot and then every 5 minutes, and runs ./update.sh
# (through auto-update.sh) when main has new commits. No sudo needed, except
# possibly once for `loginctl enable-linger` (so it runs with nobody logged in).
#
#   ./install-auto-update.sh         turn on (safe to run again)
#   ./install-auto-update.sh --off   turn off and remove
#
# Logs:       journalctl --user -u ember-auto-update
# Next check: systemctl --user list-timers ember-auto-update.timer
#
# It also switches an SSH or password-carrying `origin` to the public HTTPS
# URL (the repo is public), since a fetch with stale credentials is the usual
# reason a host's updates fail.
#
# Test-only: XDG_CONFIG_HOME decides where the unit files go; EMBER_PUBLIC_URL
# and EMBER_UPDATE_CMD stand in for the GitHub URL and ./update.sh.

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE="$UNIT_DIR/ember-auto-update.service"
TIMER="$UNIT_DIR/ember-auto-update.timer"

case "${1:-}" in
  "" ) ;;
  --off)
    systemctl --user disable --now ember-auto-update.timer 2>/dev/null || true
    systemctl --user stop ember-auto-update.service 2>/dev/null || true
    rm -f "$SERVICE" "$TIMER"
    systemctl --user daemon-reload
    echo "Automatic updates are off. ./update.sh still works by hand."
    exit 0 ;;
  *) echo "usage: $0 [--off]"; exit 1 ;;
esac

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemd is not available on this machine, so there is nothing to install."
  echo "Update by hand with ./update.sh instead."
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "node is not on your PATH. Open a shell where \`node -v\` works, then run this again."
  exit 1
fi

PUBLIC_URL="${EMBER_PUBLIC_URL:-https://github.com/ParalelSt/ember.git}"
cd "$ROOT"
origin_url="$(git remote get-url origin 2>/dev/null || true)"
if echo "$origin_url" | grep -Eq '^(ssh://|[A-Za-z0-9._-]+@[^/]+:)|://[^/@]+@'; then
  shown="$(echo "$origin_url" | sed -E 's#(://)[^/@ ]+@#\1#')"
  git remote set-url origin "$PUBLIC_URL"
  echo "Changed git remote origin from $shown to $PUBLIC_URL"
  echo "(the repo is public, so updates need no login. Only this host's checkout changed.)"
fi

# The service gets systemd's bare PATH, which has no nvm: give it the folder
# of the node used right now, plus where tmux and lsof live (update.sh needs both).
PATH_LINE="$(dirname "$(command -v node)")"
for tool in tmux lsof; do
  if p="$(command -v "$tool" 2>/dev/null)"; then PATH_LINE="$PATH_LINE:$(dirname "$p")"; fi
done
PATH_LINE="$PATH_LINE:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

if ! systemctl --user is-enabled --quiet ember.service 2>/dev/null && ! command -v tmux >/dev/null 2>&1; then
  echo "Warning: Ember does not run under systemd here and tmux is not installed."
  echo "Updates will be refused until one of them is set up, because Ember could"
  echo "not be restarted. See SETUP.md, \"Run Ember at boot\", or: sudo apt install tmux"
fi

mkdir -p "$UNIT_DIR"
cat >"$SERVICE" <<UNIT
[Unit]
Description=Ember: update from GitHub when main changes
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=$ROOT
Environment=PATH=$PATH_LINE
ExecStart="$ROOT/auto-update.sh"
# A build takes minutes. Generous, but not forever.
TimeoutStartSec=45min
# When update.sh restarts Ember in tmux, the tmux server starts inside this
# unit. Leave it alone when this run ends instead of killing the whole group.
KillMode=process
UNIT
cat >"$TIMER" <<UNIT
[Unit]
Description=Check GitHub for Ember updates every 5 minutes

[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl --user daemon-reload
systemctl --user enable --now ember-auto-update.timer

# Without lingering, user timers stop when the last session ends.
ME="$(id -un)"
if ! loginctl enable-linger "$ME" 2>/dev/null; then
  if ! sudo loginctl enable-linger "$ME"; then
    echo
    echo "Could not turn on lingering, so updates only run while you are logged in."
    echo "Ask someone with sudo to run:  sudo loginctl enable-linger $ME"
  fi
fi

echo
echo "Checking that this host can reach GitHub (./update.sh --check, changes nothing)..."
if "${EMBER_UPDATE_CMD:-$ROOT/update.sh}" --check; then
  echo "GitHub is reachable."
else
  echo "Could not reach GitHub or read the update state (see above)."
  echo "Automatic updates will keep failing until that works."
fi
echo
echo "Automatic updates are on. Next check:"
systemctl --user list-timers ember-auto-update.timer --no-legend 2>/dev/null || true
echo "Logs: journalctl --user -u ember-auto-update"
