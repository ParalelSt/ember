#!/bin/sh
# App Transport Security for the iPhone app, generated from the server this
# build points at (the iOS twin of android/app/network-security.gradle).
#
# Plain http is off for every host, except the Ember server itself when its
# URL is http:// (a self-hosted server on a LAN or Tailscale IP, or localhost
# in the simulator). An https server (Tailscale Funnel) gets no exception at
# all. The URL comes from App/capacitor.config.json, which `npx cap sync`
# writes from EMBER_APP_URL (see capacitor.config.ts), with the same fallback
# when it is absent. ATS covers the WKWebView too, so the page, its audio and
# its API calls all follow it.
#
#   http://<name>                 exception for that one host, no subdomains
#   http://<IP> / <name>.local /  NSAllowsLocalNetworking (ATS takes no per-
#   http://<no dots, localhost>   host exception for these, and this is the
#                                 narrowest switch that lets them through)
#   https://...                   nothing: ATS stays fully on
#
# One difference from Android: iOS does not apply ATS to IP literals,
# localhost or .local names at all (checked on the iOS 26 simulator: all
# three load with no key). So a build for an http IP server can also reach
# other IPs over http; that cannot be narrowed from Info.plist. Named hosts,
# which is what the internet is made of, are held to https except the one.
#
# Runs as the last build phase of the App target and edits the BUILT
# Info.plist, so the checked-in one never changes with the server URL.
# Usage outside Xcode (tests): configure-ats.sh <capacitor.config.json> <Info.plist>
set -eu

CONFIG="${1:-${SRCROOT:-.}/App/capacitor.config.json}"
PLIST="${2:-${TARGET_BUILD_DIR:-}/${INFOPLIST_PATH:-}}"
PB=/usr/libexec/PlistBuddy

if [ ! -f "$PLIST" ]; then
  echo "error: configure-ats: no Info.plist at $PLIST" >&2
  exit 1
fi

url=""
if [ -f "$CONFIG" ]; then
  url=$(plutil -extract server.url raw -o - "$CONFIG" 2>/dev/null || true)
fi
url=$(printf '%s' "$url" | tr -d '[:space:]')
[ -n "$url" ] || url="http://localhost:3000"

# Start from nothing each time: an earlier build may have added an exception.
$PB -c "Delete :NSAppTransportSecurity" "$PLIST" >/dev/null 2>&1 || true

scheme=$(printf '%s' "$url" | sed -E 's#^([A-Za-z][A-Za-z0-9+.-]*)://.*$#\1#' | tr '[:upper:]' '[:lower:]')
if [ "$scheme" != "http" ]; then
  echo "configure-ats: $url is not http, ATS stays fully on"
  exit 0
fi

authority=$(printf '%s' "$url" | sed -E 's#^[A-Za-z][A-Za-z0-9+.-]*://([^/?#]*).*$#\1#')
authority=${authority##*@}
case "$authority" in
  \[*) host=${authority#\[}; host=${host%%]*} ;;
  *) host=${authority%%:*} ;;
esac
host=$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')
if [ -z "$host" ]; then
  echo "configure-ats: no host in $url, ATS stays fully on"
  exit 0
fi

local_net=0
case "$host" in
  *:*) local_net=1 ;;                          # IPv6 literal
  *.local) local_net=1 ;;                      # Bonjour name
  *.*) printf '%s' "$host" | grep -Eq '^[0-9]+(\.[0-9]+){3}$' && local_net=1 ;;  # IPv4 literal
  *) local_net=1 ;;                            # unqualified (localhost, a LAN name)
esac

$PB -c "Add :NSAppTransportSecurity dict" "$PLIST"
if [ "$local_net" = 1 ]; then
  $PB -c "Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true" "$PLIST"
  echo "configure-ats: http to $host allowed (local networking); everything else https only"
else
  $PB -c "Add :NSAppTransportSecurity:NSExceptionDomains dict" "$PLIST"
  $PB -c "Add :NSAppTransportSecurity:NSExceptionDomains:$host dict" "$PLIST"
  $PB -c "Add :NSAppTransportSecurity:NSExceptionDomains:$host:NSExceptionAllowsInsecureHTTPLoads bool true" "$PLIST"
  $PB -c "Add :NSAppTransportSecurity:NSExceptionDomains:$host:NSIncludesSubdomains bool false" "$PLIST"
  echo "configure-ats: http to $host allowed; everything else https only"
fi
