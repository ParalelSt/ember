#!/usr/bin/env bash
#
# Quick launcher for local hosting + phone access via an EPHEMERAL tunnel.
#
#   ./start.sh
#
# Brings up:
#   1. PocketBase        (127.0.0.1:8090)
#   2. Next dev server   (127.0.0.1:3000) — proxies /pb/* to PocketBase
#   3. Web tunnel        (one public https URL — printed for your phone)
#
# Only ONE tunnel is needed: the browser reaches PocketBase through the
# app's own /pb proxy (see next.config.ts), so the whole app is one origin.
# Quick-tunnel URLs change every run — for a STATIC url use ./start-static.sh.
#
# Works on macOS/Linux natively, and Windows under Git Bash. Ctrl+C stops.

set -euo pipefail

# Resolve repo root from the script's own location (no hardcoded usernames).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PB_DIR="$ROOT/pocketbase"

# Pick the binary that exists (handles Windows .exe + Mac/Linux bare name).
pick_bin() {
  if [ -f "$1" ]; then echo "$1"
  elif [ -f "$1.exe" ]; then echo "$1.exe"
  else return 1
  fi
}

PB="$(pick_bin "$PB_DIR/pocketbase")"  || { echo "✗ PocketBase binary missing in $PB_DIR (see SETUP.md prereqs)"; exit 1; }
CF="$(pick_bin "$PB_DIR/cloudflared")" || { echo "✗ cloudflared binary missing in $PB_DIR (see SETUP.md prereqs)"; exit 1; }

TMP="$(mktemp -d)"
WEB_TUN_LOG="$TMP/web_tunnel.log"

cleanup() {
  trap - INT TERM EXIT
  echo ""
  echo "▶ stopping everything…"
  kill 0 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup INT TERM EXIT

wait_for_url() {
  local logf="$1" url="" i=0
  while [ $i -lt 60 ]; do
    url="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$logf" 2>/dev/null | head -1 || true)"
    if [ -n "$url" ]; then echo "$url"; return 0; fi
    sleep 0.5
    i=$((i + 1))
  done
  return 1
}

echo "▶ starting PocketBase…"
( cd "$PB_DIR" && exec "$PB" serve ) &

echo "▶ starting Next dev…"
( cd "$ROOT" && exec npm run dev ) &

echo "▶ starting web tunnel…"
( cd "$PB_DIR" && exec "$CF" tunnel --url http://127.0.0.1:3000 ) >"$WEB_TUN_LOG" 2>&1 &

echo "  waiting for web tunnel URL…"
WEB_URL="$(wait_for_url "$WEB_TUN_LOG")" || { echo "✗ web tunnel URL never appeared"; exit 1; }

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  📱  Open on your phone:"
echo "      $WEB_URL"
echo ""
echo "  🔧  PocketBase admin (local only):"
echo "      http://127.0.0.1:8090/_/"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  (Ctrl+C to stop everything.)"
echo ""

wait
