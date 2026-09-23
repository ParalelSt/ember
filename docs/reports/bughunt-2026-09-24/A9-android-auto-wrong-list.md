# A9. Android Auto: tapping a song played the wrong list
**What you'd notice:** in the car, you open Liked songs and tap a song. It plays, but what follows is from Recently played (or another tab), not the rest of Liked songs.
**Why it happened:** the car loads a few lists before you tap (the tab it opens and the ones next to it). A tap only tells the phone which song, so the phone guessed the list: it used whichever one it had loaded last.
**What changed:** each song the car shows now carries the list it is in (for example `liked|youtube:abc`), and the phone keeps every list it has shown, so a tap plays the rest of the right one. The songs in the queue keep their normal ids. Files: `apps/mobile/android/.../BrowseTree.kt`.
**Compare:** before = `4ca4fc3`, after = `1adb25e`.
- Test: `cd apps/mobile/android && ./gradlew testDebugUnitTest --tests 'app.ember.music.BrowseTreeTest'` (JDK 21; a fake server under Robolectric). Before the fix: 1 of 4 fails.
  - `expected:<[youtube:b, youtube:c]> but was:<[youtube:b, youtube:x, youtube:y]>` (tapped in Liked, got Recently played)
  - After: 4 of 4 pass, all 114 Kotlin tests pass, `assembleDebug` builds.
- Try it yourself (needs a new APK, and the car or the Desktop Head Unit): install the new debug build. In the car, open Liked songs, then open Recently played, then press back (the car shows Liked songs again from memory, without asking the phone). Tap the second song: the queue that follows is the rest of Liked songs, in order. Before, it was the Recently played list.
**Risk:** low. Only the ids of songs in the car's lists change; the phone app and the queue are untouched.
