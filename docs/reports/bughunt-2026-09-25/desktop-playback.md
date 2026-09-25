# Bughunt 2026-09-25: desktop native playback

Scope: the desktop app's own audio engine (`apps/desktop/src-tauri/src/audio.rs`, rodio + stream-download + souvlaki), the updater around it, and the web side that drives it (`apps/web/lib/playback/tauriBackend.ts`, `PlayerProvider.tsx`). Items already in `docs/reports/bughunt-2026-09-24/` (P02, P03, P07, A8, L3, L5, ...) were not re-reported.

Branch: `bughunt2/desktop-playback` (from `main` at `b750003`, web 0.7.11 / shells 0.4.8). No version bump, no changelog entry.

**Summary:** 11 findings, 8 fixed, 3 reported only.

| id | severity | what you'd notice | status |
|----|----------|-------------------|--------|
| D1 | medium | Desktop: at the end of the queue the player keeps saying "playing" over silence, and play does nothing | fixed |
| D2 | medium | Desktop: a seek while a song is loading is lost, the song starts at 0:00 | fixed |
| D3 | high | Desktop: the whole window freezes for seconds after clicking far ahead on the progress bar | fixed |
| D4 | high (Windows) | Windows: the app quits by itself shortly after launch, mid-song, whenever an update exists | not fixed |
| D5 | low-medium | Desktop: right after a skip the slider shows the old song's time, which can become the new song's resume point | fixed |
| D6 | low | Desktop: a native engine torn down early keeps driving the player | fixed |
| D7 | medium | Desktop: the app starts playing by itself at launch when the restored song needs web audio | fixed |
| D8 | medium | Desktop: after a song stops arriving (link drop), skipping to the next song stays silent | fixed |
| D9 | low | Desktop: a click of the song's start at launch, before the restored song pauses | fixed |
| D10 | low | Desktop: no cover art in the OS Now Playing widget for uploaded songs | not fixed |
| D11 | low | Desktop: songs skipped past keep downloading until they finish opening | not fixed |

How to run the tests:

- Rust: `cd apps/desktop/src-tauri && cargo test --lib` (macOS/Linux; the engine tests need tauri's `test` feature). After: **154 passed, 0 failed, 3 ignored** (main was 143 passed, 3 ignored). Stable across runs. `cargo clippy --lib --tests`: no new warnings.
- Web: `cd apps/web && npx vitest run lib/playback components/player hooks/player`: **40 files, 408 passed**. Full unit suite (`npx vitest run`): **293 files, 3430 passed**.

Not tried in the real desktop app (no GUI build from this sandbox). Every fix is covered by a test that drives the real engine commands on tauri's mock app against a local fake host, or by the web backend/provider unit tests.

---

## D1. The end of the queue: "playing" over silence, and play did nothing

**Severity:** medium.

**What you'd notice:** on the desktop app, the last song of a queue (an upload, a session you host, radio that found nothing, offline) plays to its end. The play button keeps showing "pause", the slider sits at the end, and nothing is heard. Pressing the button "pauses"; pressing it again says "playing" and there is still no sound. The OS play/pause key did the same. In a browser the button flips to play and pressing it starts the song again. Dragging the slider there started the song on its own. After clearing the queue the OS play/pause key sent pause to a stopped engine.

**Root cause:** three pieces. (1) The engine only sends `audio:ended` at the end, never a pause; a browser's `<audio>` fires `pause` before `ended`, which is what flips the web player's state. (2) `audio_play` on a sink that has played to its end calls rodio's `play()` on a used-up sink, which does nothing, and still reports `audio:play`. (3) A seek on a used-up sink re-opens the song with autoplay taken from "the sink is not paused", which is true for a sink that simply ran out. Also `tauriBackend.stop()` left the paused mirror at "playing".

**Fix:** `ae7843c` (engine), `4875b64` and `d0de4b9` (web).
- Engine: play on a used-up sink re-opens the song from the top (the browser behaviour). The end clears `want_play`, so a seek there re-opens paused and waits for play. Loads started from a sync command (these re-opens, P07's retry) now take their ticket at once (`begin_load` + `spawn_load`), so repeat one's "seek 0 + play" still loads the song once, not twice.
- Web: on `audio:ended`, if the provider did not load or play anything in response (the queue ran out), the backend marks itself paused and calls `onPause`. When it moved on (next song, repeat one) nothing changes, so there is no flicker on auto-advance. `stop()` marks it paused.

**Tests:**
- `cargo test --lib play_after_the_song_ran_out_plays_it_again`: before `play after the end stayed silent at 0.0s`; after passes.
- `cargo test --lib a_seek_after_the_song_ran_out_does_not_start_it`: before fails (the re-opened song played through on its own); after passes.
- `cargo test --lib repeat_one_reopens_the_song_once`: guard, passes before and after (one load plus one re-open, `load_seq == 2`). The P02 test `repeat_one_plays_the_song_again_after_it_ends` still passes.
- `npx vitest run lib/playback/tauriBackend.test.ts -t "end of a song"`: `reports a pause when nothing followed the end` before `expected "vi.fn()" to be called 1 times, but got 0 times`; the "moved on", "repeat one" and "swapped out" cases guard against a false pause. `reports paused after stop` before `expected false to be true`.

**Try it yourself:** play a single uploaded song on the desktop app and let it end. The button should turn to play; pressing it starts the song again.

---

## D2. A seek while the song was loading was lost

**Severity:** medium.

**What you'd notice:** click a song on the desktop app and, while it is still loading, click 1:00 on the progress bar (the bar is live because the catalog knows the length). The slider jumps to 1:00, then the song starts at 0:00 and the slider snaps back.

**Root cause:** `audio_seek` only acted on a loaded sink. While a load was on its way there was none, and the seek was dropped (the same shape as P07's pause during a load). A second seek right after one that re-opens the song (a backward seek in a forward-only stream, or after the end) also went to the sink about to be replaced and started a second re-open.

**Fix:** `ae7843c`, `5870d6d`, `91c000d`. Any seek while a load is in flight is kept (`pending_seek`) and the load starts there; one that lands between the start seek and the install is applied right after the install. A load now counts as settled the moment its sink goes in (under the same lock), so no seek can fall between the two.

**Tests:**
- `cargo test --lib a_seek_during_a_slow_load_is_kept`: before `the song started at Some(0.0)s, not at the 60s asked for`; after passes.
- `cargo test --lib a_seek_right_after_a_reopen_joins_it`: before `left: 3, right: 2` (one re-open too many); after passes and the song sits at 50 s.

---

## D3. A seek froze the whole window

**Severity:** high.

**What you'd notice:** on the desktop app, clicking far ahead on the progress bar of a song that has not fully arrived (the first seconds of a streamed song, or any time on a slow link or over the Funnel) freezes the whole window, beachball included, for as long as the host takes to send those bytes: seconds. With a link that has silently died the freeze lasts until the connection times out.

**Root cause:** `audio_seek` is a plain (sync) tauri command, and tauri runs those on the app's main thread. It called rodio's `Sink::try_seek`, which waits for the audio thread to carry the seek out; the decoder there waits on `StreamDownload` for the bytes it seeks to, i.e. on a new Range request. The main thread waited for all of it, holding the sink lock too (so the position timer's worker thread blocked behind it).

**Fix:** `ae7843c`, `91c000d`. The sink is now held as `Arc<Sink>`; `audio_seek` decides the plan under the lock and hands the seek to `seek_in_place`, which runs `try_seek` on a blocking thread and reports back (`audio:time`, the OS widget, or the error path) only if that sink is still the loaded one. While a seek runs on the current sink, the position timer neither reports the position being left nor counts it as a stall (capped at 25 s, so a seek that never returns cannot switch the watchdog off).

**Tests:**
- `cargo test --lib a_seek_does_not_wait_for_the_host` (a host that answers the seek's Range request after 3 s): before `audio_seek held its caller for 6.018s`; after passes (under 500 ms) and the song still lands at 100 s.
- `cache_play::the_widget_follows_a_seek_and_stops_at_the_end` was adjusted to wait for the seek, which now lands off the calling thread.

**Risk:** medium. It changes the threading of every seek. The full engine suite (153) passes, twice.

---

## D4. Windows: the updater quits the app mid-song (not fixed)

**Severity:** high on Windows, none elsewhere.

**What you'd notice:** on Windows, whenever a new desktop build exists, Ember closes by itself a little while after launch, in the middle of whatever is playing, and the installer runs.

**Root cause:** `update.rs` calls `download_and_install` at startup and says the update "applies on the NEXT launch". That holds on macOS and Linux. On Windows, `tauri-plugin-updater` 2.10.1 (`src/updater.rs`, `install_inner` for Windows) launches the NSIS/MSI installer with `ShellExecuteW` and then calls `std::process::exit(0)`.

**Why not fixed:** it needs a Windows build and a real update to verify, which this sandbox cannot do. Suggested fix: on Windows, `update.download()` at startup and keep the bytes; call `update.install(bytes)` from `RunEvent::ExitRequested` (the app is closing anyway), or offer "Restart to update" in the UI.

---

## D5. The old song's time (or end) taken for the new song's

**Severity:** low to medium.

**What you'd notice:** right after skipping on the desktop app, the slider sometimes shows the previous song's time (say 2:30) for the second or two the next song takes to load. If the app is closed then, or the new song fails and is retried on web audio, it resumes at 2:30. More rarely, pressing Next in the last moment of a song skipped two songs, or ran the "ended early" error path on the new song.

**Root cause:** the engine's reports carry no idea of which load they are about. A position (or `audio:ended`, or a playback error) sent by the old song's timer just before the engine processed the new `audio_load`, or waiting in the webview's queue while the click handler ran, arrived after the web backend had moved to the new song. It set `curTime`, cleared the "transitioning" guard, and `usePositionPersistence.noteTime` wrote it as the new song's position.

**Fix:** `792ac19`. `audio_load` takes an optional `token`; the web backend sends a new one per load. The engine puts the token of the load it is about on `audio:time`, `audio:ended` and playback errors (timer and seek), and re-opens keep the webview's token. The web backend drops a report tagged for an older load. Compatible both ways: an older shell ignores the argument and sends untagged reports, taken as before; an older web build sends no token and gets untagged reports.

**Tests:**
- `npx vitest run lib/playback/tauriBackend.test.ts -t "song it just left"`: before `expected "vi.fn()" to not be called at all, but actually been called 1 times` (the 150 s position, and the stale end), and `expected [ undefined, undefined ] to deeply equal [ 1, 2 ]`; after 4 of 4 pass, including "takes untagged reports as before".
- `cargo test --lib reports_carry_the_tag_of_the_load_they_are_about an_untagged_load_reports_untagged`: pass (the first is new behaviour, the second the compatibility guard).

---

## D6. Listeners registered after destroy were never removed

**Severity:** low.

**What you'd notice:** mostly nothing in a packaged build. If the native backend is torn down before its `listen()` calls resolve (a swap to web audio during startup, React dev double-mount), its event handlers stay live and the dead engine's events drive the player next to its replacement.

**Root cause:** `tauriBackend` pushed each unlisten function into a list when its promise resolved; `destroy()` only called the ones already there.

**Fix:** `4875b64`. A `destroyed` flag: a listener that resolves afterwards is unregistered at once, and handlers do nothing once destroyed.

**Test:** `npx vitest run lib/playback/tauriBackend.test.ts -t "teardown"`: before `expected 7 to be +0`; after passes.

---

## D7. The web-audio fallback started the song by itself

**Severity:** medium.

**What you'd notice:** open the desktop app with a restored song the native engine cannot decode (one the host serves as webm/opus): a moment later it starts playing on its own, without anyone pressing play. The same happened whenever the fallback fired while paused.

**Root cause:** the launch load is paused (`userInteracted` is false), but when it fails with "try web audio", `fallbackToWebAudio` reloaded the song on web audio with `autoplay: true`, and the desktop webview allows autoplay.

**Fix:** `c564b9c`. The fallback follows the launch load's rule (`userInteracted.current`), and clears the loaded-track guard so the paused load on the new engine is not skipped as "already loaded".

**Test:** `npx vitest run components/player/PlayerProvider.fallbackAutoplay.test.tsx`: before `expected { autoplay: true, startAt: 42 } to match object { autoplay: false }`; after 2 of 2 pass (the second checks the song still plays when the listener asked for it).

---

## D8. After a song stopped arriving, the next one stayed silent

**Severity:** medium.

**What you'd notice:** on the desktop app, the connection drops mid-song and the song stops. You skip to the next song, even one in the auto cache: it shows as playing, sits at 0:00 in silence, and a few seconds later the app gives up on its own engine and switches to web audio (media keys and the Now Playing widget stop working for the rest of the session).

**Root cause:** every sink plays on one audio thread (the output mixer). The starved song's decoder is blocked in `StreamDownload::read`, which waits as long as the download task keeps retrying. `silence_current` dropped and stopped the sink, but a stopped sink only ends once its `next()` returns, so the mixer, and the next song with it, stayed blocked.

**Fix:** `e7ffecc`. Each streamed load keeps its download's cancel handle; silencing a sink (track change) and `audio_stop` cancel it. stream-download then marks the stream done and failed, the blocked read returns an error, the old source ends and the mixer moves on.

**Test:** `cargo test --lib the_next_song_plays_when_the_one_before_starved` (a host that stops sending mid-song and never answers the reconnect): before `the next song is stuck at 0.0s`; after passes in about 1 s.

**Limit:** stream-download only notices the cancel between chunks and reconnects. A download stuck inside a Range request the host never answers (a seek into bytes not yet fetched, over a dead link) still blocks until that request fails.

---

## D9. A paused or resumed load leaked the song's start

**Severity:** low.

**What you'd notice:** a short click or blip of the restored song's first moment when the desktop app opens (the song is loaded paused), or of 0:00 before a resumed song jumps to where it was. On a busy machine, more than a blip.

**Root cause:** a new rodio `Sink` starts out playing. The engine appended the decoder, then seeked to the resume point, then decided play or pause. Everything in between went to the speakers. Found when the D1 seek test flaked under full-suite load: the re-opened song played to its end before it was paused.

**Fix:** `e7ffecc`. The sink is paused before the decoder goes in; play or pause is decided at install as before.

**Test:** `cargo test --lib a_paused_load_makes_no_sound` (a mixer drain that counts non-silent samples): before `left: 48, right: 0`; after passes.

---

## D10. No cover art for uploaded songs in the OS widget (not fixed)

**Severity:** low, cosmetic.

**What you'd notice:** macOS Now Playing / Windows media overlay shows no cover for a member upload with embedded art, while the app shows it.

**Root cause:** `setMetadata` hands the OS the absolute `/api/uploads/<id>/art` URL. That route requires a session (`requireUser`), and the OS fetches the image itself without the webview's cookie (souvlaki on macOS uses `NSImage initWithContentsOfURL`), so it gets a 401.

**Why not fixed:** needs the engine to fetch the art with the session cookie into a temp file and pass a `file://` URL, and a real OS widget to check. Low value for the risk in this pass.

---

## D11. Songs skipped past keep downloading until they open (not fixed)

**Severity:** low.

**What you'd notice:** skipping quickly through several songs that are not cached makes the one you stop on slower to start on a slow link.

**Root cause:** a superseded load is only discarded after `open_source` finishes (headers, buffering, decoder). Until then its connection and download compete with the current one. `open_source_retrying` already takes a `still_wanted` check but only uses it before a retry.

**Why not fixed:** no measured user-visible cost here (for a first play the host spends most of that time running yt-dlp before sending any bytes). A fix would pass `still_wanted` into `while_progressing` and the connect wait.

---

## Review round

A separate review of the diff found gaps in these fixes, all closed in `089975c`:

- D7: Space and the OS media keys call the engine's play directly, not the provider's toggle, so `userInteracted` stayed false and a fallback after such a play loaded the song paused. Now any real `onPlay` counts. Test: `PlayerProvider.fallbackAutoplay.test.tsx` "resumed with Space or a media key", before `expected { autoplay: false, startAt: 42 } to match object { autoplay: true }`.
- D2: a seek applied right after the install skipped `plan_seek`, so a backward one in a forward-only track would end the song. It is now planned like any seek (re-open when needed). A seek taken by a load that is then overtaken is handed back to the newer load.
- D5: a load failure, the load's `audio:play` and `audio:duration` now carry the token too, and the web backend drops stale duration and play (a stale length also clamped seeks). Test: `tauriBackend.test.ts` "drops the previous song's length and play", before `expected "vi.fn()" to not be called at all`.
- D3: when a slow seek landed, the OS widget was told the play state from when the seek began; a pause in between left it on "Playing". Test: `cargo test --lib a_pause_during_a_slow_seek_leaves_the_widget_paused`, before `widget: Some(Playing { progress: Some(MediaPosition(100s)) })`.
- D1: the end of a song cleared `want_play` even when a newer load had just set it (a click right as the old song ended could load the new one paused). It now checks that no load is in flight.

## Test results (final)

- `cargo test --lib` (apps/desktop/src-tauri, shared target dir): 154 passed, 0 failed, 3 ignored.
- `cargo clippy --lib --tests`: only warnings that exist on `main`.
- `npx vitest run lib/playback components/player hooks/player` (apps/web): 40 files, 408 tests passed. Full `npx vitest run`: 293 files, 3430 passed.
- `npx tsc --noEmit`: no errors in changed files (the `RouteContext` errors are pre-existing, generated route types).
- `npx eslint` on the changed web files: clean except errors that already exist on `main` (`PlayerProvider.tsx` ref writes during render).
