#!/usr/bin/env bash
# Build the Ember macOS app, then tell you exactly how to run it.
#
#   ./scripts/build-mac.sh              → points at the live server (funnel)
#   ./scripts/build-mac.sh --local      → points at http://localhost:3000
#   ./scripts/build-mac.sh --url <URL>  → points anywhere you like
#
# WHY --local MATTERS: the desktop app is a thin shell that DOWNLOADS the Ember
# web app from whichever server you point it at. So web-side changes (like the
# audio fallback) only appear if that server is running the new code. To test
# unreleased web changes, run `./start-static.sh` on this branch and build with
# --local. Pointing at the funnel gives you whatever your friend has deployed.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

URL="https://ember.tailf4de41.ts.net"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --local) URL="http://localhost:3000"; shift ;;
    --url)   URL="${2:?--url needs a value}"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

echo "Building Ember.app → will load: $URL"

# Sign with the Developer ID cert if there is one; otherwise build unsigned
# (fine for running it yourself, warns on other people's Macs).
IDENT="$(security find-identity -v -p codesigning 2>/dev/null \
  | grep 'Developer ID Application' | head -1 | sed -E 's/.*"(.*)"/\1/')" || true
if [[ -n "${IDENT:-}" ]]; then
  export APPLE_SIGNING_IDENTITY="$IDENT"
  echo "Signing as: $IDENT"
else
  echo "No Developer ID certificate — building UNSIGNED."
fi

# Notarize only if credentials were stored once (see APPS.md).
if xcrun notarytool history --keychain-profile "AC_PASSWORD" >/dev/null 2>&1; then
  export APPLE_KEYCHAIN_PROFILE="AC_PASSWORD"
  echo "Notarizing (profile AC_PASSWORD)"
else
  echo "Not notarized — fine for you, warns on other Macs."
fi

export EMBER_APP_URL="$URL"

# `tauri build` also tries to wrap the .app in a .dmg, and DMG creation drives
# Finder via AppleScript. That fails in non-GUI shells (CI, background agents)
# AFTER the .app is already built, so treat it as non-fatal and check for the
# .app ourselves.
set +e
npm run build
BUILD_STATUS=$?
set -e

APP="src-tauri/target/release/bundle/macos/Ember.app"
DMG="$(ls src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null | head -1 || true)"
rm -f src-tauri/target/release/bundle/macos/rw.*.dmg   # failed dmg leftovers

if [[ ! -d "$APP" ]]; then
  echo
  echo "BUILD FAILED — no app produced (exit $BUILD_STATUS)." >&2
  exit 1
fi

echo
echo "================================================================"
echo "Built: $(cd "$(dirname "$APP")" && pwd)/Ember.app"
[[ -n "$DMG" ]] && echo "DMG:   $DMG"
[[ -z "$DMG" ]] && echo "DMG:   not created (Finder/AppleScript unavailable in this shell) — the .app works fine"
echo
echo "Run it:"
echo "  open \"$(cd "$(dirname "$APP")" && pwd)/Ember.app\""
echo
echo "It will load: $URL"
[[ "$URL" == http://localhost:3000 ]] && echo "  → start the server first: ./start-static.sh (from the repo root)"
echo "Logs:  ~/Library/Logs/Ember/ember-desktop.log"
echo "Debug: right-click inside the app → Inspect Element"
echo "================================================================"
