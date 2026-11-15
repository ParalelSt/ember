#!/usr/bin/env bash
#
# Build the "Ember Test" Android app from any branch and put it on the LAN
# so the phone can install it from Chrome. It installs next to the real
# Ember (package app.ember.music.test, its own name and a blue icon), so
# your real app, account and saved songs are never touched.
#
#   scripts/test-apk.sh                         # this branch, server on :3072
#   scripts/test-apk.sh ui/info-changes         # another branch
#   scripts/test-apk.sh HEAD --port 3050        # a different sandbox server
#   scripts/test-apk.sh HEAD --server http://192.168.1.50:3000
#   scripts/test-apk.sh HEAD --server https://ember.x.ts.net \
#       --version 0.4.34-presence1 --code 100 --out /tmp/EmberTest.apk
#                                     # a file, no LAN; --code above any Ember
#                                     # Test already on the phone
#
# EMBER_DISCORD_DIAG=1 and DISCORD_APP_ID in the environment reach the build
# (docs/APPS.md, "Discord status (Android app)").
#
# The build happens in its own worktree (spotify-clone-wt/test-apk), so the
# branch you are on stays as it is. The test-only edits are made there and
# never committed.

set -euo pipefail

REF="HEAD"
PORT=3072
SERVER=""
SERVE_PORT=8780
VERSION=""
CODE=""
OUT_FILE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --server) SERVER="$2"; shift 2 ;;
    --version) VERSION="$2"; shift 2 ;;
    --code) CODE="$2"; shift 2 ;;
    --out) OUT_FILE="$2"; shift 2 ;;
    -h|--help) sed -n '2,23p' "$0"; exit 0 ;;
    *) REF="$1"; shift ;;
  esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MAIN="$(cd "$HERE" && cd "$(git rev-parse --git-common-dir)/.." && pwd)"
WT="$(dirname "$MAIN")/spotify-clone-wt/test-apk"
OUT="$HOME/.ember-test-apk"

IP=""
if [ -z "$OUT_FILE" ]; then
  IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  [ -n "$IP" ] || { echo "✗ No LAN address found (Wi-Fi off?)."; exit 1; }
fi
if [ -z "$SERVER" ]; then
  [ -n "$IP" ] || { echo "✗ --out needs --server: there is no LAN sandbox to point at."; exit 1; }
  SERVER="http://$IP:$PORT"
fi

if ! curl -s -o /dev/null -m 5 "$SERVER"; then
  echo "✗ Nothing answers at $SERVER. Start the sandbox server first (SINK=1 ...)."
  exit 1
fi

SHA="$(cd "$HERE" && git rev-parse --verify "$REF^{commit}")"
echo "→ building $REF ($(cd "$HERE" && git log --format='%h %s' -1 "$SHA"))"
echo "→ app points at $SERVER"

# A fresh, detached copy of the branch. Never npm install in a worktree:
# node_modules are links to the main checkout's.
if [ ! -d "$WT" ]; then
  git -C "$MAIN" worktree add -q --detach "$WT" "$SHA"
else
  git -C "$WT" checkout -q --force --detach "$SHA"
  git -C "$WT" clean -qfd -- apps/mobile/android
fi
for dir in "" apps/web/ apps/mobile/; do
  [ -e "$WT/${dir}node_modules" ] || ln -s "$MAIN/${dir}node_modules" "$WT/${dir}node_modules"
done

# The test-only edits: own package, own name, blue icon background.
A="$WT/apps/mobile/android/app"
perl -0pi -e 's/buildTypes \{\n/buildTypes {\n        debug {\n            applicationIdSuffix ".test"\n        }\n/ unless /applicationIdSuffix/' "$A/build.gradle"
perl -pi -e 's/>Ember</>Ember Test</g' "$A/src/main/res/values/strings.xml"
perl -pi -e 's/#FFFFFF/#2563EB/' "$A/src/main/res/values/ic_launcher_background.xml"
perl -pi -e 's/const val PACKAGE = "app\.ember\.music"/const val PACKAGE = "app.ember.music.test"/' \
  "$A/src/main/java/app/ember/music/UpdateRules.kt"
if [ -n "$VERSION" ]; then
  VERSION="$VERSION" perl -pi -e 's/versionName "[^"]*"/versionName "$ENV{VERSION}"/' "$A/build.gradle"
fi
if [ -n "$CODE" ]; then
  [[ "$CODE" =~ ^[0-9]+$ ]] || { echo "✗ --code must be a number."; exit 1; }
  CODE="$CODE" perl -pi -e 's/versionCode \d+/versionCode $ENV{CODE}/' "$A/build.gradle"
fi

bash "$WT/apps/mobile/scripts/build-apk.sh" "$SERVER"

if [ -n "$OUT_FILE" ]; then
  mkdir -p "$(dirname "$OUT_FILE")"
  cp "$A/build/outputs/apk/debug/app-debug.apk" "$OUT_FILE"
  echo
  echo "✓ Ember Test ($SERVER): $OUT_FILE"
  exit 0
fi

mkdir -p "$OUT"
cp "$A/build/outputs/apk/debug/app-debug.apk" "$OUT/EmberTest.apk"

if ! lsof -nP -iTCP:"$SERVE_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  nohup python3 -m http.server "$SERVE_PORT" --directory "$OUT" >/dev/null 2>&1 &
  sleep 1
fi
echo
echo "✓ Ember Test is ready. On the phone (same Wi-Fi), open in Chrome:"
echo "    http://$IP:$SERVE_PORT/EmberTest.apk"
