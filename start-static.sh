#!/usr/bin/env bash
#
# Launcher for the persistent-tunnel mode (Tailscale Funnel).
#
#   ./start-static.sh
#
# Assumes `tailscale funnel --bg $PORT` is already running — see SETUP.md.
# Starts:
#   1. PocketBase                       (127.0.0.1:${POCKETBASE_PORT}, default 8090)
#   2. Next in PRODUCTION mode          (127.0.0.1:$PORT, default 3000) — proxies /pb/* to PocketBase
#
# Both ports come from apps/web/.env.local:
#   PORT=3000
#   POCKETBASE_PORT=8090
# Either or both may be omitted to keep the defaults. See PORTS.md.
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
ENV_FILE="$ROOT/apps/web/.env.local"

pick_bin() {
  if [ -f "$1" ]; then echo "$1"
  elif [ -f "$1.exe" ]; then echo "$1.exe"
  else return 1
  fi
}

PB="$(pick_bin "$PB_DIR/pocketbase")" || { echo "✗ PocketBase binary missing in $PB_DIR (see SETUP.md prereqs)"; exit 1; }

# Read PORT + POCKETBASE_PORT out of apps/web/.env.local without sourcing the
# whole file (sourcing would expose every secret in there to this shell).
read_env() {
  local key="$1"
  [ -f "$ENV_FILE" ] || return 0
  # `|| true` catches grep's no-match exit (1) so pipefail doesn't kill the
  # script via set -e when the key isn't in .env.local. Empty output then
  # flows through the rest of the pipe and we keep the default.
  { grep -E "^${key}=" "$ENV_FILE" || true; } | tail -1 | cut -d= -f2- | tr -d '\r' | tr -d '"' | tr -d "'"
}

PORT="$(read_env PORT)"
PORT="${PORT:-3000}"

POCKETBASE_PORT="$(read_env POCKETBASE_PORT)"
POCKETBASE_PORT="${POCKETBASE_PORT:-8090}"

# Tell Next where PB is. Overrides whatever's in .env.local so changing
# POCKETBASE_PORT alone is enough — POCKETBASE_URL stays in sync automatically.
export POCKETBASE_URL="http://127.0.0.1:${POCKETBASE_PORT}"
export PORT

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
if curl -fsS -m 1 "http://127.0.0.1:${POCKETBASE_PORT}/api/health" > /dev/null 2>&1; then
  echo "▶ PocketBase already running on :${POCKETBASE_PORT}, skipping start."
else
  echo "▶ starting PocketBase on :${POCKETBASE_PORT}…"
  ( cd "$PB_DIR" && exec "$PB" serve --http "127.0.0.1:${POCKETBASE_PORT}" ) &
fi

echo "▶ building the web app (production, webpack)…"
# --webpack opts out of Turbopack, which refuses to follow the .venv/bin/python
# symlink that escapes the project root (used by lib/sources/youtube.ts to
# spawn the Python player). Webpack happily ignores it.
( cd "$ROOT/apps/web" && npx next build --webpack )

echo "▶ starting Next on :${PORT} (production)…"
# Run `next start` directly instead of via `npm start` — the two layers of
# npm (root → workspace) each print a noisy "code 130" error when Ctrl+C
# sends them SIGINT. next handles SIGINT cleanly, so going direct gives a
# quiet shutdown.
( cd "$ROOT/apps/web" && exec npx next start -p "$PORT" ) &

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  📱  App is live at your Tailscale Funnel URL"
echo "      (https://ember.<your-tailnet>.ts.net)"
echo ""
echo "  🔧  PocketBase admin (local only):"
echo "      http://127.0.0.1:${POCKETBASE_PORT}/_/"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  (Ctrl+C to stop.)"
echo ""

wait
