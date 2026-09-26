# Bug hunt 2026-09-25: Android native playback

Branch `bughunt2/android-playback` (from main at web 0.7.11 / shells 0.4.8). Scope: the Media3 playback service and the `EmberPlayer` Capacitor plugin (`apps/mobile/android/app/src/main/java/app/ember/music`), the web side bridge (`apps/web/lib/playback/androidBackend.ts`) and `PlayerProvider`'s Android paths. Known items from `docs/reports/bughunt-2026-09-24/` (A1, A3, A4, A7, A9, A12, P01, P05, P06, P11, P12) were not re-reported.

Method: code reading and lifecycle reasoning, then a failing test per fix where one can show it: Kotlin tests on a real ExoPlayer under Robolectric (`./gradlew testDebugUnitTest`, JDK 21 from Android Studio), web tests with vitest. No emulator or device was used, so every fix below that changes the APK still needs one real-phone check (listed per finding).

**Summary:** 15 findings: 11 fixed (10 bugs and the normalization feature), 4 reported only. Most of the fixes need a new APK; A1, A7 and A8 are partly on the web side and A1 only works fully with the new APK (older builds keep today's behavior, see there).

| Id | Severity | What you'd notice | Status |
|----|----------|-------------------|--------|
| A1 | High | Opening the app while music plays jumps back to an old song | Fixed `95b50e2`, `0536a77` |
| A2 | Medium | After a tap on the last song, the app shows the wrong song; a later change restarts the previous one | Fixed `95b50e2` |
| A3 | Low | A player command at app start could be lost | Fixed `95b50e2` |
| A4 | Medium | Uploaded songs never show their cover in the notification, lock screen or car | Fixed `857590c` |
| A5 | Low | Previous always went back a song instead of restarting it | Fixed `b039604` |
| A6 | High | A weak signal (tunnel, dead zone) skipped songs, then stopped for good | Fixed `523419f`, `3e23d0d` |
| A7 | Medium | Native radio dropped the playlist and broke unshuffle | Fixed `ea1c63e` |
| A8 | Medium | After Android closed the app, the song restarted from 0:00 | Fixed `821525c` |
| A9 | Medium | With the screen off, a streamed song could run dry | Fixed `dbbca88` |
| A10 | Medium | Play in the car after Android closed the app did nothing | Fixed `b1ca30f` |
| N1 | Feature | Volume normalization did nothing on Android | Done `d1590a5` |
| A11 | Low | The car's Shuffle button is invisible to the app | Not fixed |
| A12 | Low | Upload covers in the car's browse lists | Not fixed |
| A13 | Low | Headset / steering wheel play after Android closed the app | Not fixed |
| A14 | Info | Lock-screen controls vanishing on track advance | Not found on native |

---

## A1. Opening the app while music plays jumped back to an old song (High)

**What you'd notice:** music keeps playing without the app on screen: started from the car, or the app was swiped away from recents while playing, and the phone moved on a few songs. You open the app, and the music jumps back to the song the app last saw (or to a whole other list), from the top.

**Why it happened:** a fresh page restores its saved queue and hands it to the native player (A7 of the last hunt made that hand-over paused). But nothing checked whether native was already playing something. The saved queue is only as new as the moment the page last ran; native had moved on (auto-advance, the car's own list). The hand-over made native seek back to the saved song (same list) or load the saved list (another list), and since only "paused" was asked for, not "pause", it kept playing.

**What changed:** the paused hand-over waits until native has said what it has (new plugin method `getQueue`, and the existing `getState`). Native playing something: the page takes native's queue (or, same list, just native's position in it) and sends nothing. Native empty (a real cold start): the saved queue goes over as before. A tap never waits. There is no time limit (a first version gave up after 2 s, which on a slow cold start was exactly when native may already play; `0536a77`); only a failed bridge call sends the saved queue. An app build without `getQueue` keeps the saved queue off native when it is the one native plays; otherwise it behaves as today. Files: `androidBackend.ts`, `EmberPlayerPlugin.kt`.

- Test: `cd apps/web && npx vitest run lib/playback/androidBackend.test.ts` (8 tests in "a page starting while native already plays", including a getState that answers after 30 s). Against the old `androidBackend.ts` the first version's tests failed 5 of 7 (`expected "vi.fn()" to not be called` for the saved-queue push). After: all pass.
- Try it (new APK): play a playlist, swipe the app away from recents, let two songs go by, open the app: the music does not jump, and the app shows the song that plays.
- Risk: medium. It changes what a fresh page does at startup, and only when native already has a queue.

## A2. Native radio right after a tap was never reported to the app (Medium)

**What you'd notice:** tap the last song of an album (or any search result, which is a one-song queue). The phone's player adds radio songs; when it moves on to one, the app still shows the old song, and the next change the app sends (add to queue, shuffle) makes native jump back to the previous song from the top.

**Why it happened:** the plugin hid every native queue change within 1.5 s of the app's own `setQueue`, to avoid reporting the app's change back to it. Native radio is fetched as soon as the last song is heard, which is often inside that window, so it was hidden too. The app's queue was then shorter than native's, the app ignored the out-of-range index, and its next full-queue send asked native for a song that was no longer the playing one.

**What changed:** the plugin compares ids instead of the clock (`QueueEcho`): the queue the app last sent or was last told about is not news, and neither are the steps while `QueueSync` applies a send; anything else is reported once. Files: `EmberPlayerPlugin.kt`.

- Test: `./gradlew testDebugUnitTest --tests 'app.ember.music.QueueEchoTest'` (6 tests, including "native radio appended right after the app's send is news"). The old rule was an inline timestamp check with no seam to test; the failure is by reasoning above.
- Risk: low to medium. If some Media3 path reports a queue that differs only transiently, the app would mirror it (it already mirrored car changes this way).

## A3. A player call made while the plugin connected could be lost (Low)

**What you'd notice:** rarely, at app start, one command (the saved queue, the loop mode, or the startup `getState`) did nothing, and its promise never settled.

**Why it happened:** plugin methods run on Capacitor's own thread and checked `controller` there, while the controller connection landed on the main thread. A call that saw "not connected" but was queued just after the main thread drained the queue was never run (and `pending` was an unsynchronized list touched by two threads).

**What changed:** the decision and the queue both live on the main thread. Files: `EmberPlayerPlugin.kt`. No test (a thread interleaving); fix by reasoning, covered by the full suite still passing.

## A4. Upload covers never showed on the phone's media controls (Medium)

**What you'd notice:** a song you uploaded (with a cover) shows a blank tile in the notification, on the lock screen and on the car's now-playing screen. YouTube songs are fine.

**Why it happened:** an upload's `artworkUrl` is relative (`/api/uploads/<id>/art`) and behind sign-in. `TrackItems` made the stream URL absolute but passed the cover through as-is, and Media3's default image loader has no cookie anyway.

**What changed:** the cover URL is made absolute like the stream, and the session gets its own image loader (`ArtworkSources`): the Ember cookie for covers on the Ember server, a plain client for every other host (so YouTube's image servers never see the session cookie; `ServerApi.http` adds it to every request). Files: `ArtworkSources.kt` (new), `TrackItems.kt`, `EmberPlaybackService.kt`.

- Test: `--tests 'app.ember.music.ArtworkSourcesTest'` (two fake servers): the relative cover becomes absolute (fails before: `expected:<https://ember.example/api/uploads/u1/art> but was:</api/uploads/u1/art>`), the Ember server gets the cookie, a foreign host gets none.
- Try it (new APK): play an upload with a cover, look at the notification and the lock screen.

## A5. Previous always jumped to the song before (Low)

**What you'd notice:** in the Android app, pressing Previous a minute into a song went to the previous song. On the web, desktop, the notification and the car it starts the song over.

**Why it happened:** the plugin called `seekToPreviousMediaItem`; the rest of Ember follows the 3-second rule (`seekToPrevious`).

**What changed:** `seekToPrevious()`. Files: `EmberPlayerPlugin.kt`. Test: `--tests 'app.ember.music.PreviousButtonTest'` (a minute in: restarts; first second: previous song).

## A6. A weak signal skipped songs, then stopped (High)

**What you'd notice:** driving through a tunnel or a dead zone, the song in the buffer plays out, then the player skips to the next song, and the next, about one a minute, and after five it stops for good, even once the signal is back. You lose songs and have to press play.

**Why it happened:** the skip-a-broken-song rule (A3 of the last hunt) treats every error as the song's fault when the phone counts as online, and Android keeps a weak cell network "validated", so the offline rules never took over. A connection failure or timeout is not the song's fault.

**What changed:** the player's load error policy (`PatientLoadErrors`, new) retries a connection failure or timeout while online after 2, 5, 10, 20 and 30 s, inside ExoPlayer: the song keeps its place and the player stays "buffering", so the service keeps its foreground. Offline the same error is final at once, so the offline rules move to a song on the phone sooner than before. A 4xx is final at once (a song the server does not have is skipped faster). When the patience runs out, the listener stays on the song instead of skipping (play, or the network coming back, resumes it). Broken songs are still skipped. The first version (`523419f`) retried from the listener after the error, which left the player idle between tries and Media3 then drops the foreground service; the review caught it and `3e23d0d` replaced it. Files: `PatientLoadErrors.kt` (new), `QueueListener.kt`, `EmberPlaybackService.kt`.

- Test: `--tests 'app.ember.music.PatientLoadErrorsTest'` (4: the delays, offline and 404 final, and the service's own player against an unreachable address: still buffering with no error after 15 s online, which fails without the policy; failing at once offline). `--tests 'app.ember.music.QueueListenerTest'`: a connection error online stays on the song (the old listener moved to the next song).
- Try it (new APK): play, then turn on flight mode while keeping Wi-Fi off for 2 minutes with the screen on the app: the song stays, and plays on once flight mode is off (press play if it stopped).
- Risk: medium. A server that is down now leaves the player buffering one song for about two minutes, then stopped on it, instead of cycling through five. Generic read errors (not the two network codes) now get 5 tries instead of 3 before they surface.

## A7. Native radio dropped the playlist and broke unshuffle (Medium)

**What you'd notice:** with shuffle on, when the phone's player added radio at the end of the queue, the shuffle button still showed on but did nothing; the app also forgot which playlist it was playing from. After a tap in the car, the page's shuffle button could stay lit with nothing to undo.

**Why it happened:** the provider treated every native queue as a brand new one: `context` and the shuffle backup were cleared, but the `shuffle` flag was not.

**What changed:** a native queue that only appends keeps the context and extends the shuffle backup with the new songs; a genuinely new list also turns the page's shuffle off. Files: `PlayerProvider.tsx`. Test: `npx vitest run components/player/PlayerProvider.android.test.tsx` (2 new tests; the first fails before on the lost context).

## A8. After Android closed the app, the song restarted from 0:00 (Medium)

**What you'd notice:** pause a song halfway, leave the phone; Android closes the app overnight. Open it and press play: the song starts from the beginning. On the web and desktop it resumes.

**Why it happened:** the Android path always handed the restored song to native at 0 (to stop a new song inheriting the old one's time, P11). A cold start is the one case where the saved time does belong to the song.

**What changed:** the cold-start hand-over (autoplay off) carries the saved position (`setQueue` `startSec`), used by native only when it has to start the song, never when it already plays it. Songs picked or moved to still start at 0. The page's opening render also no longer sends the saved queue a second time. Files: `PlayerProvider.tsx`, `androidBackend.ts`, `types.ts`, `QueueSync.kt`, `EmberPlayerPlugin.kt`. Tests: `QueueSyncTest` (2 new), `PlayerProvider.android.test.tsx` and `androidBackend.test.ts` (3 new). Older app builds ignore `startSec` and keep starting at 0.

## A9. Screen off, a streamed song could run dry (Medium)

**What you'd notice:** with the screen off (especially on Wi-Fi), a streamed song stops mid-way to buffer, or the next song is slow to start.

**Why it happened:** the player never held a wake lock or a Wi-Fi lock. The audio output keeps the CPU up while sound plays, but not the network between buffer fills; ExoPlayer's docs call for `WAKE_MODE_NETWORK` for exactly this.

**What changed:** `setWakeMode(C.WAKE_MODE_NETWORK)` and the `WAKE_LOCK` permission (normal, no prompt). ExoPlayer holds the locks only while playing or buffering to play. Files: `EmberPlaybackService.kt`, `AndroidManifest.xml`. Test: `--tests 'app.ember.music.WakeModeTest'` (held while streaming, released on pause; fails without the line: `WakeModeTest.kt:55`).

## A10. Play in the car after Android closed the app did nothing (Medium)

**What you'd notice:** the phone killed Ember in the background. In the car, pressing play (without browsing) does nothing until you open the app on the phone.

**Why it happened:** a new process starts with an empty player, and the session had no `onPlaybackResumption`, so Media3 had nothing to load.

**What changed:** the service keeps its queue, song and position on disk as they change (`SavedQueue`, written off the main thread, replaced atomically) and hands it back from `onPlaybackResumption`. Files: `SavedQueue.kt` (new), `EmberPlaybackService.kt`. Test: `--tests 'app.ember.music.SavedQueueTest'` (3 tests).
- Try it (new APK): play in the car, stop, force-stop Ember from Settings, press play in the car: the same song resumes where it was.
- Not covered: a headset or steering-wheel button with no car connected (A13).

## N1. Volume normalization on Android (feature, done)

The web player's per-song normalization (web 0.7.10) was skipped on Android because the native player moves between songs by itself. It now runs natively:

- `Normalizer` (`Normalization.kt`) asks the server's `/api/tracks/<id>/loudness` for the playing and the next song (only `youtube:` ids, like the web), keeps found gains in memory and on disk (2000 max) so offline downloads stay normalized, and never keeps "not measured yet".
- On every song change it sets the player's volume to `listener level x gain` (clamped at full, the web's rule outside party mode). The next song's gain is fetched ahead, so the level is right from its first note; Android applies a volume change at once, unlike an audio processor, which would already have processed the start of the next song at the old level.
- `LevelPlayer`, a `ForwardingPlayer` given to the MediaSession, turns the app's (and any controller's) `setVolume` into the listener level, so the slider never wipes the gain and a song change never wipes the slider. The prank overlay's duck still works: it treats any volume write as the new level and ducks it.
- The Settings switch reaches native through `setNormalize` (new plugin method; the web sends it at start and on change). Default on, like the web. Older app builds ignore it; the web still sends no per-song gain to Android.
- Tests: `--tests 'app.ember.music.NormalizationTest'` (7: dB clamp, per-song level on a real ExoPlayer, slider, off and unmeasured songs, disk cache, duck, the server route), `PlayerProvider.android.test.tsx` (the setting reaches native, no gain on `setVolume`).
- Try it (new APK): Settings, normalization on; play a loud modern song then a quiet older one: similar loudness. Turn it off: the difference is back.
- Limits: a song whose gain is unknown when it starts (first song of a new queue on a slow server) plays unchanged for a moment, then changes level once the answer arrives. The level is set on the song-change event, so with back-to-back songs the first few milliseconds of a song can still play at the previous level. Controllers are told the applied volume (level x gain) in volume events while `getVolume()` returns the listener level; nothing reads it back today, but code that does later must use the listener level. Lookups run on their own thread.

## A11. The car's Shuffle button is invisible to the app (Low, not fixed)

The car and the notification's Shuffle button toggles Media3's own `shuffleModeEnabled`. The app never reads it (its shuffle reorders the queue instead), so after a Shuffle press in the car the app's Up next shows the unshuffled order, native shuffle stays on until the car turns it off, and shuffling in the app on top shuffles twice. Fix plan: make the car button do what the app's shuffle does (reorder the upcoming items natively with `moveMediaItems`, keep the order to undo it) and report it as a queue change, or mirror `state.shuffle` into the store. Not done: it changes how shuffle behaves in the car and needs a car test.

## A12. Upload covers in the car's browse lists (Low, not fixed)

After A4 the browse items carry the absolute cover URL, but the car's screen fetches browse covers itself, without the Ember cookie, so upload covers in the car's lists still show blank (as before). Needs a `ContentProvider` serving covers (or a short-lived signed URL from the server).

## A13. Headset or steering-wheel play after Android closed the app (Low, not fixed)

A10 covers controllers that connect to the session (the car). A Bluetooth headset or steering-wheel button with no app process needs Media3's `MediaButtonReceiver` in the manifest. Not added: it starts the service in the foreground from the background, and without a device test there is a risk of Android's "foreground service did not start in time" crash when nothing is saved. With `onPlaybackResumption` in place this is a manifest entry plus a device test.

## A14. Lock-screen controls vanishing on track advance (Info)

The referenced debugging doc (`docs/superpowers/specs/2026-06-12-lockscreen-controls-debugging-status.md`) is not in the repo. On the native player the notification belongs to one Media3 session and one player that moves between items itself; no code path releases or rebuilds the session on a transition, and P01 (last hunt) fixed the double load that made the web player blink. Nothing found on native. Stream URL expiry also does not apply on Android: stream URLs are Ember server routes, not signed YouTube URLs.

---

## Test results

- Kotlin: `cd apps/mobile/android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew testDebugUnitTest assembleDebug --rerun-tasks`: 321 tests, 0 failures, 0 errors (291 on main before this branch; 30 new across QueueEchoTest, ArtworkSourcesTest, PreviousButtonTest, NormalizationTest, PatientLoadErrorsTest, WakeModeTest, SavedQueueTest, QueueSyncTest and QueueListenerTest). `assembleDebug` builds.
- Web: `cd apps/web && npx vitest run`: 292 files, 3430 tests, all pass. `tsc --noEmit` shows only the known `RouteContext` errors that need Next's typegen; eslint on the changed files adds no problems (`PlayerProvider.tsx` keeps its 3 known ones).
- Not run: an emulator or a phone. Every "Try it" above needs the new debug APK.
- Review: an independent review of the branch found two real problems in the first versions (A1's 2 s timeout, A6's idle retries), both fixed (`0536a77`, `3e23d0d`), plus the thread tidying in `0536a77`.
