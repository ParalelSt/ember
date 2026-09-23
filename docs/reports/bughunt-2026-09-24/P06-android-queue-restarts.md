# P06. Shuffle restarted the song on phones, and a tap loaded it twice
**What you'd notice:** in the Android app, turning shuffle on or off, or removing a song from the playing playlist, jumped the current song back to 0:00. Tapping a song in a new album or playlist started it, cut it off and started it again a moment later.
**Why it happened:** the app sends the phone's player the whole queue after every change, and the phone's player threw its queue away and reloaded the song from the top whenever the list was not exactly the same or simply longer. A tap sent the queue twice: first just the tapped song (the new list was not saved yet), then the full list.
**What changed:** the phone's player now keeps the playing song, and where it is in it, whenever that song is still the one asked for, and only swaps the songs before and after it. A tap sends the new list once. Files: `apps/mobile/android/.../QueueSync.kt` (new, the decision), `EmberPlayerPlugin.kt`, `apps/web/components/player/PlayerProvider.tsx`.
**Compare:** before = `1fe61a3`, after = `316dc18`.
- Test: `cd apps/mobile/android && ./gradlew testDebugUnitTest --tests 'app.ember.music.QueueSyncTest'` (JDK 21; runs on a real ExoPlayer under Robolectric). Run on the old decision (moved as-is into `QueueSync`): 7 of 13 fail.
  - `expected:<42000> but was:<0>` (shuffle, unshuffle, removing a song: the 42 s playhead reset to 0)
  - `expected:<Around(before=true, after=true, appendFrom=null)> but was:<Load(index=2)>`
  - After: 13 of 13 pass, all 103 Kotlin tests pass, `assembleDebug` builds.
- Test: `cd apps/web && npx vitest run components/player/PlayerProvider.android.test.tsx`: fails before, passes after.
  - `expected [ [ [ { …(11) } ], +0, true ], …(1) ] to deeply equal [ [ …(3) ] ]` (a one-song queue sent first, 2 of 7 fail)
  - After: 7 of 7 pass, P01's Android test still passes; full unit suite 2714/2715 (the known flaky `dizajn/sve` timeout passes alone).
- Try it yourself (needs a new APK): install the new debug build. Play an album, wait until 0:30, turn shuffle on, then off: the song keeps playing from 0:30 both times. In a playlist, remove a song other than the playing one: no jump. Tap a song in a different album: it starts once, with no stutter.
**Risk:** medium. It changes how the phone's player swaps its queue. Tapping the song that is already playing, in a different list, now keeps it going instead of restarting it (tapping it in the same list already did).
