# A8. Desktop: stop during a slow load was ignored, and the song started anyway

**What you'd notice:** on the desktop app, a song is still loading when the player is told to stop: you clear the queue, or the app gives up on the desktop audio engine and switches to web audio. A second later the song starts anyway. In the switch case you could hear two songs at once, one from each engine.

**Why it happened:** stop only threw away a song that was already loaded. While a song was on its way there was nothing to throw away, so the load carried on, and it still had "play when ready" set.

**What changed:** stop now cancels a load in flight, the same way clicking a different song does, clears "play when ready", and tells the OS media widget "stopped" instead of leaving it on "playing". A load that finishes also double-checks, right before it goes in, that nobody stopped it in the meantime. Files: `apps/desktop/src-tauri/src/audio.rs` (audio_stop, load_track), test in `apps/desktop/src-tauri/src/audio/transport_repro.rs`.

**Compare:** before = `354716b`, after = `73c3f12`.
- Test: `cd apps/desktop/src-tauri && cargo test --lib a_stop_during_a_slow_load_is_kept`: fails before (`stop was pressed during the load, yet a sink went in`, `left: Some((true, false))`, meaning the song loaded and played), passes after. Full `cargo test --lib`: 66 passed, 2 ignored.
- Screenshots: not visual.
- Try it yourself: in the desktop app, click a song you have never played (it takes a few seconds) and clear the queue right away: after the fix nothing plays.

**Risk:** low. Stop now also cancels a load, which is what stop means; loads, play and pause on their own work exactly as before.
