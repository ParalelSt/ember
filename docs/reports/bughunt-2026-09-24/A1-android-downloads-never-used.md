# A1. The Android app never played downloaded songs from the phone
**What you'd notice:** you download a playlist in the Android app, go somewhere without signal (or turn on flight mode), and the songs do not play. Online, downloaded songs still used mobile data.
**Why it happened:** the phone's own player (the one that also drives Android Auto) was always given the song's internet address. The downloads were saved fine, but nothing ever pointed the player at them.
**What changed:** each time a song starts loading, the phone's player checks for a downloaded copy and plays that instead. A song downloaded after it was queued is picked up too, and one whose download you removed streams again. The web side (P09's browser downloads) is untouched: on Android the app's own downloads are used. Files: `apps/mobile/android/.../OfflineAudio.kt` (new), `TrackItems.kt`, `EmberPlaybackService.kt`.
**Compare:** before = `e7a39b1`, after = `0b60c1e`.
- Test: `cd apps/mobile/android && ./gradlew testDebugUnitTest --tests 'app.ember.music.OfflinePlaybackTest'` (JDK 21; the service's own player, real ExoPlayer under Robolectric, a fake server). Before the fix (the player setup moved as-is into `buildPlayer`): 1 of 3 fails.
  - `a downloaded song is read from the phone: the server was not asked expected:<0> but was:<1>`
  - After: 4 of 4 pass (one more for seeking inside a song), all 122 Kotlin tests pass, `assembleDebug` builds.
- Try it yourself (needs a new APK): install the new debug build. Open a playlist and download it, and wait until it says it is downloaded. Turn on flight mode. Play the playlist: the songs play, on the phone and in the car. Turn flight mode off and play a song you did not download: it streams as before.
**Risk:** medium. It changes where the phone's player reads every song from, but only differs for a song that has a downloaded file. If a download is removed in the middle of a song and you then seek in it, that song fails and the next one starts (A3).
