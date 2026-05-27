#!/usr/bin/env bash
#
# One-command launcher for local hosting + phone access.
#
#   ./start.sh
#
# Brings up, in order:
#   1. PocketBase            (127.0.0.1:8090)
#   2. PocketBase tunnel     (public https URL — auto-written into .env.local)
#   3. Next dev server       (127.0.0.1:3000)
#   4. Web tunnel            (public https URL — printed for your phone)
#
# Ctrl+C stops all four. Quick tunnels mint fresh URLs each run; the script
# wires the PocketBase one into apps/web/.env.local automatically.

set -euo pipefail

ROOT="/Users/aronmatoic/Documents/Main Projects/spotify-clone"
PB_DIR="$ROOT/pocketbase"
ENV_FILE="$ROOT/apps/web/.env.local"
CF="$PB_DIR/cloudflared"
PB="$PB_DIR/pocketbase"

TMP="$(mktemp -d)"
PB_TUN_LOG="$TMP/pb_tunnel.log"
WEB_TUN_LOG="$TMP/web_tunnel.log"

# Kill every process in this script's process group on exit, then clean temp.
cleanup() {
  trap - INT TERM EXIT
  echo ""
  echo "▶ stopping everything…"
  kill 0 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup INT TERM EXIT

# Poll a cloudflared log for its public URL (up to ~30s).
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
[ -f "$ENV_FILE" ] || { echo "✗ $ENV_FILE not found"; exit 1; }

# --- 1. PocketBase --------------------------------------------------------
echo "▶ starting PocketBase…"
( cd "$PB_DIR" && exec "$PB" serve ) &

# --- 2. PocketBase tunnel -------------------------------------------------
echo "▶ starting PocketBase tunnel…"
( cd "$PB_DIR" && exec "$CF" tunnel --url http://127.0.0.1:8090 ) >"$PB_TUN_LOG" 2>&1 &

echo "  waiting for PocketBase tunnel URL…"
PB_URL="$(wait_for_url "$PB_TUN_LOG")" || { echo "✗ PocketBase tunnel URL never appeared"; exit 1; }
echo "  → $PB_URL"

# --- write it into .env.local --------------------------------------------
if grep -q '^NEXT_PUBLIC_POCKETBASE_URL=' "$ENV_FILE"; then
  sed -i '' "s|^NEXT_PUBLIC_POCKETBASE_URL=.*|NEXT_PUBLIC_POCKETBASE_URL=$PB_URL|" "$ENV_FILE"
else
  printf '\nNEXT_PUBLIC_POCKETBASE_URL=%s\n' "$PB_URL" >> "$ENV_FILE"
fi
grep -q '^POCKETBASE_URL=' "$ENV_FILE" || printf 'POCKETBASE_URL=http://127.0.0.1:8090\n' >> "$ENV_FILE"
echo "  wrote NEXT_PUBLIC_POCKETBASE_URL into .env.local"

# --- 3. Next dev ----------------------------------------------------------
echo "▶ starting Next dev…"
( cd "$ROOT" && exec npm run dev ) &

# --- 4. Web tunnel --------------------------------------------------------
echo "▶ starting web tunnel…"
( cd "$PB_DIR" && exec "$CF" tunnel --url http://127.0.0.1:3000 ) >"$WEB_TUN_LOG" 2>&1 &

echo "  waiting for web tunnel URL…"
WEB_URL="$(wait_for_url "$WEB_TUN_LOG")" || { echo "✗ web tunnel URL never appeared"; exit 1; }

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  📱  Open on your phone:"
echo "      $WEB_URL"
echo ""
echo "  🔧  PocketBase admin:"
echo "      $PB_URL/_/"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  (Ctrl+C to stop all four processes.)"
echo ""

# Block until any child exits / Ctrl+C, then the trap tears everything down.
wait
