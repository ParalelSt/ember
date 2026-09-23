# A7. Opening the Android app added a play nobody made, and could drop the playlist
**What you'd notice:** opening the Android app (without pressing play) put the last song you had on into Recently played again. If that song was the last one in the queue, a moment later the queue filled with radio songs and the app forgot which playlist you were in.
**Why it happened:** on opening, the app hands the phone's player your saved queue, paused. The phone's player counted every song it moved to as a play, playing or not, and when it was on the last song it fetched radio for the car. That radio then replaced the app's queue.
**What changed:** a song now counts (and radio is fetched) only once it is actually heard. Songs that follow on while music plays, and a song on repeat, count every time as before. A song that fails and gets skipped is no longer counted either. Files: `apps/mobile/android/.../QueueListener.kt`.
**Compare:** before = `2ae5cc0`, after = `09b90d3`.
- Test: `cd apps/mobile/android && ./gradlew testDebugUnitTest --tests 'app.ember.music.QueueListenerTest'` (JDK 21; a real ExoPlayer under Robolectric). Before the fix: 3 of 10 fail.
  - `restoring a paused queue records no play: expected:<[]> but was:<[a]>`
  - `restoring a paused queue on its last song fetches no radio: expected:<0> but was:<1>`
  - `each song that follows on while playing counts: expected:<3> but was:<4>` (a song still loading was counted before it was heard)
  - After: 10 of 10 pass, all 113 Kotlin tests pass, `assembleDebug` builds.
- Try it yourself (needs a new APK): install the new debug build. Play a song from a playlist, pause it, and swipe the app away from recent apps. Open the app again and do not press play. On the computer, Recently played has no new entry for that song. Now press play: it shows up once. Repeat with the last song of a playlist: after opening, the queue still shows the playlist and no radio songs appear until you play.
**Risk:** low. Plays are still counted from the car and from the phone; only songs never heard stop being counted.
