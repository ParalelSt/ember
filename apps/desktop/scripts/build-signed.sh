#!/usr/bin/env bash
# Signed (and, when configured, notarized) macOS build of the Ember desktop app.
#
#   ./scripts/build-signed.sh
#
# Signing: uses the "Developer ID Application" certificate in your login
# keychain. Override with APPLE_SIGNING_IDENTITY if you have more than one.
#
# Notarization: only runs if you've stored credentials once, with
#   xcrun notarytool store-credentials "AC_PASSWORD" \
#     --apple-id you@example.com --team-id 8B8D2GSC9U \
#     --password <app-specific-password-from-appleid.apple.com>
# Without it the app is still SIGNED, but Gatekeeper shows the
# "unidentified developer" warning on other people's Macs.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

# --- signing identity -------------------------------------------------------
if [[ -z "${APPLE_SIGNING_IDENTITY:-}" ]]; then
  APPLE_SIGNING_IDENTITY="$(
    security find-identity -v -p codesigning \
      | grep "Developer ID Application" \
      | head -1 \
      | sed -E 's/.*"(.*)"/\1/'
  )" || true
fi
if [[ -z "$APPLE_SIGNING_IDENTITY" ]]; then
  echo "No 'Developer ID Application' certificate found in the keychain." >&2
  echo "Build unsigned with: npm run build" >&2
  exit 1
fi
export APPLE_SIGNING_IDENTITY
echo "Signing as: $APPLE_SIGNING_IDENTITY"

# --- notarization (optional) ------------------------------------------------
NOTARY_PROFILE="${APPLE_KEYCHAIN_PROFILE:-AC_PASSWORD}"
if xcrun notarytool history --keychain-profile "$NOTARY_PROFILE" >/dev/null 2>&1; then
  export APPLE_API_KEY_PATH=""            # profile-based auth, not API key
  export APPLE_KEYCHAIN_PROFILE="$NOTARY_PROFILE"
  echo "Notarizing with keychain profile: $NOTARY_PROFILE"
else
  echo "No notarytool profile '$NOTARY_PROFILE' — building SIGNED but NOT notarized."
  echo "  (other Macs will warn 'unidentified developer'; see the header of this script)"
fi

# EMBER_APP_URL is baked into the binary by prepare:url.
: "${EMBER_APP_URL:=https://ember.tailf4de41.ts.net}"
export EMBER_APP_URL
echo "App will load: $EMBER_APP_URL"

npm run build

echo
echo "Artifacts:"
find src-tauri/target/release/bundle -maxdepth 2 -name '*.dmg' -o -maxdepth 2 -name '*.app' | sed 's/^/  /'
echo
echo "Verify with:"
echo "  codesign -dv --verbose=4 src-tauri/target/release/bundle/macos/Ember.app"
echo "  spctl -a -vvv -t install src-tauri/target/release/bundle/macos/Ember.app"
