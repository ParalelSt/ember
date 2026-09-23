# A3. One song that would not play stopped the whole queue on Android, in the car too
**What you'd notice:** in the Android app or Android Auto, when a song could not be played (removed from the server, a stream that failed), the music just stopped. Nothing moved on to the next song until you picked up the phone.
**Why it happened:** the phone's player stops on an error and waits. The app's web side used to handle errors by itself, but on Android it leaves playback to the phone's player, and nothing there told it to go on.
**What changed:** when a song fails while music should be playing, the phone's player now moves to the next song. After 5 failures in a row (no network, signed out) it stops trying, so it cannot spin forever; pressing play or picking a song gives it 5 fresh tries. A paused player is left alone. Files: `apps/mobile/android/.../QueueListener.kt` (new; the service's queue listener moved here as-is, then the fix), `EmberPlaybackService.kt`.
**Compare:** before = `354716b`, after = `4285569`.
- Test: `cd apps/mobile/android && ./gradlew testDebugUnitTest --tests 'app.ember.music.QueueListenerTest'` (JDK 21; a real ExoPlayer under Robolectric, songs that point at a missing file). Run on the listener as it was: 4 of 6 fail.
  - `the queue moved on to the next song expected:<1> but was:<0>`
  - `expected:<3> but was:<0>` (three broken songs in a row: stuck on the first)
  - After: 6 of 6 pass, all 109 Kotlin tests pass, `assembleDebug` builds.
- Try it yourself (needs a new APK): install the new debug build. Upload a song, add it to a playlist between two other songs, then delete the upload on the computer. On the phone, play the song before it and skip ahead to near its end: when the deleted song fails, the next one starts by itself. Same in the car.
**Risk:** low. It only acts on an error while music is meant to be playing; skipped songs still show as errors in the log.
