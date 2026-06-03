#!/usr/bin/env bash
#
# Launcher for the persistent-tunnel mode (Tailscale Funnel).
#
#   ./start-static.sh
#
# Assumes `tailscale funnel --bg 3000` is already running — see SETUP.md.
# Starts:
#   1. PocketBase    (127.0.0.1:8090)
#   2. Next dev      (127.0.0.1:3000) — proxies /pb/* to PocketBase
#
# Your app is reachable at the Tailscale Funnel URL (e.g.
# https://ember.<your-tailnet>.ts.net). Ctrl+C stops both.

set -euo pipefail

ROOT="/Users/aronmatoic/Documents/Main Projects/spotify-clone"
PB_DIR="$ROOT/pocketbase"
PB="$PB_DIR/pocketbase"

cleanup() {
  trap - INT TERM EXIT
  echo ""
  echo "▶ stopping…"
  kill 0 2>/dev/null || true
}
trap cleanup INT TERM EXIT

[ -x "$PB" ] || { echo "✗ PocketBase binary missing at $PB"; exit 1; }

echo "▶ starting PocketBase…"
( cd "$PB_DIR" && exec "$PB" serve ) &

echo "▶ starting Next…"
( cd "$ROOT" && exec npm run dev ) &

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
