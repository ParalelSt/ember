#!/usr/bin/env bash
#
# Quick launcher for local hosting + phone access via an EPHEMERAL tunnel.
#
#   ./start.sh
#
# Brings up, in order:
#   1. PocketBase        (127.0.0.1:8090)
#   2. Next dev server   (127.0.0.1:3000) — proxies /pb/* to PocketBase
#   3. Web tunnel        (one public https URL — printed for your phone)
#
# Only ONE tunnel is needed: the browser reaches PocketBase through the
# app's own /pb proxy (see next.config.ts), so the whole app is one origin.
# Quick-tunnel URLs change every run — for a STATIC url use ./start-static.sh.
#
# Ctrl+C stops everything.

set -euo pipefail

ROOT="/Users/aronmatoic/Documents/Main Projects/spotify-clone"
PB_DIR="$ROOT/pocketbase"
CF="$PB_DIR/cloudflared"
PB="$PB_DIR/pocketbase"

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

# --- sanity ---------------------------------------------------------------
[ -x "$PB" ] || { echo "✗ PocketBase binary missing at $PB"; exit 1; }
[ -x "$CF" ] || { echo "✗ cloudflared binary missing at $CF"; exit 1; }

# --- 1. PocketBase --------------------------------------------------------
echo "▶ starting PocketBase…"
( cd "$PB_DIR" && exec "$PB" serve ) &

# --- 2. Next dev ----------------------------------------------------------
echo "▶ starting Next dev…"
( cd "$ROOT" && exec npm run dev ) &

# --- 3. Web tunnel --------------------------------------------------------
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
