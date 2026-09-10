#!/usr/bin/env bash
# Phone calls must interrupt Ember, and Ember must come back afterwards.
#
# Nothing in Ember's own code pauses for a call: ExoPlayer is built with
# `setAudioAttributes(..., handleAudioFocus = true)` (EmberPlaybackService.kt),
# so Media3 asks for audio focus, the incoming call takes it away transiently,
# Media3 suppresses playback, and it un-suppresses when the call ends. This
# test is what proves that chain still works after a Media3 upgrade or a
# player-construction change.
#
# It drives a real emulator, so it needs one running with Ember already
# playing:
#
#   1. sandbox PocketBase + web app (see tests/README.md), app on :3010
#   2. $ANDROID_HOME/emulator/emulator -avd ember_test -no-snapshot-load &
#   3. cd apps/mobile && npm run apk -- http://10.0.2.2:3010
#      adb install -r android/app/build/outputs/apk/debug/app-debug.apk
#      adb shell am start -n app.ember.music/.MainActivity
#   4. sign in, open Library -> Uploads, play a track that is at least a
#      minute long (the call sequence takes ~25 seconds)
#   5. npm run test:android-call
#
# Env: ADB (path to adb), ADB_SERIAL (which device), CALLER (number to ring).
set -uo pipefail

ADB="${ADB:-${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}/platform-tools/adb}"
CALLER="${CALLER:-5551234}"
TIMEOUT="${TIMEOUT:-15}"      # seconds to wait for a state change
IN_CALL_HOLD="${IN_CALL_HOLD:-6}"  # seconds to stay on the call

command -v "$ADB" >/dev/null 2>&1 || { echo "FAIL  no adb at $ADB (set ADB=...)"; exit 1; }
SERIAL="${ADB_SERIAL:-$("$ADB" devices | awk '/^emulator-[0-9]+\tdevice$/{print $1; exit}')}"
[ -n "$SERIAL" ] || { echo "FAIL  no running emulator (adb devices shows none)"; exit 1; }
adbx() { "$ADB" -s "$SERIAL" "$@"; }

fails=0
ok()   { echo "PASS  $1"; }
bad()  { echo "FAIL  $1"; fails=$((fails + 1)); }

# Ember's own MediaSession line out of dumpsys. Matching the session id rather
# than the package keeps us off the "Media button session is ..." header line,
# which is followed by whichever session happens to top the stack.
session_line() {
  adbx shell dumpsys media_session 2>/dev/null |
    awk '/androidx.media3.session.id\. app.ember.music/{f=1} f&&/state=PlaybackState/{print; exit}'
}
state()    { session_line | sed -E 's/.*state=([A-Z_]+)\(.*/\1/'; }
# Anchored on the state, because the same line also carries "buffered
# position=", and a greedy match would hand back that one instead.
position() { session_line | sed -E 's/.*state=[A-Z_]+\([0-9]+\), position=([0-9-]+),.*/\1/'; }

# Poll instead of sleeping a fixed amount: focus changes land in well under a
# second, but a cold emulator can take several.
wait_for_state() {
  local want="$1" deadline=$((SECONDS + TIMEOUT)) seen=""
  while [ "$SECONDS" -lt "$deadline" ]; do
    seen="$(state)"
    [ "$seen" = "$want" ] && return 0
    sleep 0.5
  done
  echo "      wanted $want, saw ${seen:-nothing}"
  return 1
}

hang_up() { adbx emu gsm cancel "$CALLER" >/dev/null 2>&1; }
trap hang_up EXIT

echo "Ember call handling on $SERIAL"

# Precondition: something has to be playing, or every later step is vacuous.
start_state="$(state)"
if [ -z "$start_state" ]; then
  echo "FAIL  Ember has no media session. Start the app and play a track first"
  exit 1
fi
if [ "$start_state" != "PLAYING" ]; then
  echo "FAIL  Ember is $start_state, not PLAYING. Play a track first"
  exit 1
fi
playing_at="$(position)"
ok "playing before the call (position ${playing_at}ms)"

# 1. Ringing. The ringtone takes transient focus, so this alone must pause us.
adbx emu gsm call "$CALLER" >/dev/null 2>&1
if wait_for_state PAUSED; then ok "paused while the phone rings"; else bad "still playing while the phone rings"; fi
paused_at="$(position)"

# 2. Answered. The call holds focus, so nothing may creep back in.
adbx emu gsm accept "$CALLER" >/dev/null 2>&1
sleep "$IN_CALL_HOLD"
if [ "$(state)" = "PAUSED" ]; then ok "still paused ${IN_CALL_HOLD}s into the call"; else bad "resumed during the call (state $(state))"; fi

# 3. Hung up. Focus comes back and Media3 un-suppresses on its own.
hang_up
if wait_for_state PLAYING; then ok "playing again after the call"; else bad "did not resume after the call"; fi
resumed_at="$(position)"

# Resuming from the top would be as wrong as not resuming at all.
if [ -n "$paused_at" ] && [ -n "$resumed_at" ] && [ "$resumed_at" -ge $((paused_at - 2000)) ]; then
  ok "resumed where it stopped (${paused_at}ms -> ${resumed_at}ms)"
else
  bad "restarted instead of resuming (${paused_at}ms -> ${resumed_at}ms)"
fi

[ "$fails" -eq 0 ] && { echo "all checks passed"; exit 0; }
echo "$fails check(s) failed"
exit 1
