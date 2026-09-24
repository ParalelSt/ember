# L5. The desktop OS media widget had no scrubber and never said "stopped"

**What you'd notice:** on macOS Now Playing / Windows SMTC / Linux MPRIS, Ember showed play/pause and the song name, but no progress bar and no way to see or drag to a position. When a song list finished playing to the end (not skipped, not paused, just ran out), the widget stayed stuck showing "Playing" forever.

**Why it happened:** the code that tells the OS widget "playing" or "paused" never included the current position, so the widget had nothing to draw a scrubber with. Separately, the metadata sent over (title/artist/album) never included the song's duration. And the one thing that DID set the widget to "Stopped" was the explicit stop button — a song simply running out at the end of the queue never told the widget anything, so it kept showing the last state.

**What changed:** play/pause updates now include the current position, metadata now includes duration (refreshed once the decoder knows it), and a track running out on its own now sets the widget to Stopped too (a later track loading right after simply overrides that, same as normal). Files: `apps/desktop/src-tauri/src/audio.rs`.

**Compare:** before = `137c44e`, after = `444d420`.
- Test: `CARGO_TARGET_DIR=.../stream-stall/apps/desktop/src-tauri/target cargo test --lib audio::tests::nowplaying_state` (from `apps/desktop/src-tauri`): the new `nowplaying_state` mapping tests fail before with `assertion failed` (progress was hardcoded to `None`, e.g. `nowplaying_state_carries_position_when_playing` expected `Playing { progress: Some(MediaPosition(42s)) }` but got `progress: None`), pass after. Full suite: `cargo test --lib` → `test result: ok. 83 passed; 0 failed`.
- Screenshots: none — needs a real OS media widget (macOS Now Playing, Windows SMTC) to see, not reproducible in a screenshot from this sandbox.
- Try it yourself: play a song on the desktop app and open macOS Control Center's Now Playing (or Windows' media overlay) — there should now be a scrubber. Let a queue finish naturally and the widget should drop to stopped instead of staying on "Playing".
**Risk:** low, OS widget cosmetics only; no change to actual playback.
