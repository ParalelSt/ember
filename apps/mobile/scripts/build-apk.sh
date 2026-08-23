#!/usr/bin/env bash
#
# Build a debug APK you can sideload onto your phone.
#
#   ./scripts/build-apk.sh https://ember.<tailnet>.ts.net
#   ./scripts/build-apk.sh https://ember.<tailnet>.ts.net --install   # adb install too
#
# The server URL is BAKED INTO THE APK at build time (Capacitor writes it into
# assets/capacitor.config.json). Change servers → rebuild. Passing the wrong URL
# gives you an app stuck on "connecting…", which looks like a crash but isn't.
#
# Prereqs: Android SDK + a JDK 17+. Android Studio ships one, so if you have
# Studio installed you already have everything.

set -euo pipefail

APP_URL="${1:-}"
INSTALL="${2:-}"

if [ -z "$APP_URL" ]; then
  echo "usage: $0 <EMBER_APP_URL> [--install]"
  echo
  echo "  <EMBER_APP_URL>  the live Ember server the app points at, e.g."
  echo "                   https://ember.<tailnet>.ts.net"
  echo
  echo "  A phone CANNOT reach http://localhost:3000 — localhost on the phone"
  echo "  is the phone. Use the Tailscale funnel URL or your Mac's LAN IP."
  exit 1
fi

case "$APP_URL" in
  http://localhost*|http://127.0.0.1*)
    echo "✗ $APP_URL is unreachable from a physical phone."
    echo "  Use the Tailscale funnel URL (https://ember.<tailnet>.ts.net) or"
    echo "  your Mac's LAN IP (http://192.168.x.x:3000)."
    exit 1
    ;;
esac

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

# Android Studio's bundled JDK, unless the environment already has a good one.
if [ -z "${JAVA_HOME:-}" ] || ! "${JAVA_HOME}/bin/java" -version 2>&1 | grep -qE '"(17|21|24)'; then
  STUDIO_JBR="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  if [ -d "$STUDIO_JBR" ]; then
    export JAVA_HOME="$STUDIO_JBR"
  else
    echo "✗ Need a JDK 17+. Install Android Studio, or set JAVA_HOME yourself."
    exit 1
  fi
fi
export PATH="$JAVA_HOME/bin:$PATH"

# Locate the SDK: env var first, then the two usual install paths.
if [ -z "${ANDROID_HOME:-}" ]; then
  for candidate in "$HOME/Library/Android/sdk" "/opt/homebrew/share/android-commandlinetools"; do
    [ -d "$candidate" ] && export ANDROID_HOME="$candidate" && break
  done
fi
if [ -z "${ANDROID_HOME:-}" ]; then
  echo "✗ Android SDK not found. Set ANDROID_HOME, or install Android Studio."
  exit 1
fi
export PATH="$ANDROID_HOME/platform-tools:$PATH"

echo "→ server URL : $APP_URL"
echo "→ JAVA_HOME  : $JAVA_HOME"
echo "→ ANDROID_HOME: $ANDROID_HOME"
echo

EMBER_APP_URL="$APP_URL" npx cap sync android

cd android
./gradlew assembleDebug

APK="$DIR/android/app/build/outputs/apk/debug/app-debug.apk"
echo
echo "✓ APK: $APK"

if [ "$INSTALL" = "--install" ]; then
  if ! command -v adb >/dev/null; then
    echo "✗ adb not on PATH — install platform-tools or copy the APK across manually."
    exit 1
  fi
  if [ -z "$(adb devices | sed -n '2p')" ]; then
    echo "✗ No device. Plug the phone in, enable USB debugging, accept the prompt."
    exit 1
  fi
  adb install -r "$APK"
  echo "✓ installed"
else
  echo
  echo "To install: plug the phone in with USB debugging on, then"
  echo "  adb install -r \"$APK\""
  echo "Or AirDrop/copy the APK to the phone and open it."
fi
