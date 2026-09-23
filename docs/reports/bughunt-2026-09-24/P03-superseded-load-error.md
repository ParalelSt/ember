# P03. Desktop: a song you skipped past could break the song now playing

**What you'd notice:** on the desktop app, you click a song that is slow to arrive, then click another one, which starts playing. A few seconds later the first song fails in the background, and the song you are listening to stops with "Couldn't load", or the app quietly switches to web audio for the rest of the session (the keyboard media keys and the Now Playing widget stop working).

**Why it happened:** the desktop audio engine already threw away a slow song that finished loading after you had moved on, but only when it loaded fine. When it failed, it still sent the error to the app, and the app treats every error as being about the song it has now.

**What changed:** a failed load that is no longer the newest one is written to the app log and not reported. The engine's playback commands now also run on Tauri's test app, so a new test file can drive them the way the app does. Files: `apps/desktop/src-tauri/src/audio.rs` (load_track), `apps/desktop/src-tauri/src/audio/transport_repro.rs` (new tests), `apps/desktop/src-tauri/Cargo.toml` (test-only feature).

**Compare:** before = `405ab61`, after = `12b5df7`.
- Test: `cd apps/desktop/src-tauri && cargo test --lib transport_repro`: `a_superseded_loads_failure_is_not_blamed_on_the_song_now_playing` fails before with `song B was blamed for song A: [("audio:error", "...could not decode the song: Unrecognized format","retry":"web-audio")]`, passes after. The before run used the fix commit with only the new check removed, because the test needs the test-only feature that commit adds. `the_current_loads_failure_is_still_reported` passes both times (a real failure is still shown). Full `cargo test --lib`: 61 passed, 2 ignored.
- Screenshots: not visual.
- Try it yourself: hard to trigger by hand. In the desktop app, click a song the host cannot download (it spins for a while), then click a song that plays at once. Before, when the first one gave up, the second stopped or the app switched to web audio. After, the second keeps playing, and the app log shows `superseded, failure not reported`.

**Risk:** low. It only changes what happens to a load that has already been replaced by a newer one.
