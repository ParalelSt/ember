#!/usr/bin/env bash
#
# Launcher for the persistent-tunnel mode (Tailscale Funnel).
#
#   ./start-static.sh
#
# Assumes `tailscale funnel --bg 3000` is already running — see SETUP.md.
# Starts:
#   1. PocketBase                       (127.0.0.1:8090)
#   2. Next in PRODUCTION mode          (127.0.0.1:3000) — proxies /pb/* to PocketBase
#
# Production mode (not `next dev`) is used so:
#   - No dev-origin CSRF check (Tailscale tunnel hostnames work out of the box).
#   - It's faster and stable to leave running.
# Re-run this whenever you change code (it rebuilds first).
#
# Works on macOS/Linux natively, and Windows under Git Bash. Ctrl+C stops.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PB_DIR="$ROOT/pocketbase"

pick_bin() {
  if [ -f "$1" ]; then echo "$1"
  elif [ -f "$1.exe" ]; then echo "$1.exe"
  else return 1
  fi
}

PB="$(pick_bin "$PB_DIR/pocketbase")" || { echo "✗ PocketBase binary missing in $PB_DIR (see SETUP.md prereqs)"; exit 1; }

# Only react to explicit Ctrl+C / TERM. NOT EXIT — otherwise a `set -e` abort
# (e.g. the build step failing) would tear down PocketBase too, leaving the
# user with nothing running. On natural exit we leave background children;
# they get reparented and keep going so a re-run of this script can detect
# PB is already up and skip starting another instance.
cleanup() {
  trap - INT TERM
  echo ""
  echo "▶ stopping…"
  kill 0 2>/dev/null || true
}
trap cleanup INT TERM

# Skip starting PB if it's already running (e.g. survived a previous failed
# build, or the user started it manually). Avoids a port-conflict crash.
if curl -fsS -m 1 http://127.0.0.1:8090/api/health > /dev/null 2>&1; then
  echo "▶ PocketBase already running, skipping start."
else
  echo "▶ starting PocketBase…"
  ( cd "$PB_DIR" && exec "$PB" serve ) &
fi

echo "▶ building the web app (production, webpack)…"
# --webpack opts out of Turbopack, which refuses to follow the .venv/bin/python
# symlink that escapes the project root (used by lib/sources/youtube.ts to
# spawn the Python player). Webpack happily ignores it.
( cd "$ROOT/apps/web" && npx next build --webpack )

echo "▶ starting Next (production)…"
( cd "$ROOT" && exec npm start ) &

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  📱  App is live at your Tailscale Funnel URL"
echo "      (https://ember.<your-tailnet>.ts.net)"
echo ""
echo "  🔧  PocketBase admin (local only):"
echo "      http://127.0.0.1:8090/_/"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  (Ctrl+C to stop.)"
echo ""

wait
