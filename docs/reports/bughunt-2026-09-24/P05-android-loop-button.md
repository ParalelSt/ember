# P05. The loop button did nothing on phones
**What you'd notice:** in the Android app, tapping loop (all, or one) changed the icon but the music ignored it: the song did not repeat and the album did not start over at the end. The Repeat button in the car or notification also never showed on the app's loop button.
**Why it happened:** on Android the phone's own music player plays the songs and decides what comes next, but the app never told it the loop setting. It only knew about the loop mode in the web part, which on Android is not the one playing.
**What changed:** the native player got a "set repeat" command, the app sends it whenever the loop button changes (and at startup), and a Repeat press in the car or notification now updates the app's loop button. Files: `apps/mobile/android/.../EmberPlayerPlugin.kt`, `LoopModes.kt` (new), `apps/web/lib/playback/androidBackend.ts`, `apps/web/components/player/PlayerProvider.tsx`.
**Compare:** before = `9c61889`, after = `f36871d`.
- Test: `cd apps/web && npx vitest run lib/playback/androidBackend.test.ts components/player/PlayerProvider.android.test.tsx`: fails before, passes after.
  - `TypeError: b.setLoop is not a function` / `expected [] to deeply equal [ [ 'all' ], [ 'one' ], [ 'off' ] ]` / `ev.onLoopMode is not a function` (8 of 17 fail)
  - After: 17 of 17 pass; full unit suite 2709/2711 (2 upload tests that time out under load pass when rerun alone).
- Test: `cd apps/mobile/android && ./gradlew testDebugUnitTest` (JDK 21): `LoopModesTest` would not compile before (`Unresolved reference 'LoopModes'`); after, 90 of 90 pass and `assembleDebug` builds.
- Screenshots: none (needs a phone).
- Try it yourself (needs a new APK): install the new debug build. Play an album, tap loop until it shows loop-one, let the song end: the same song starts again. Tap loop to loop-all, skip to the last song, let it end: the first song plays. Then pull down the notification and press Repeat: the loop icon in the app changes to match.
**Risk:** low. New command only; an older APK simply lacks it and nothing is sent.
