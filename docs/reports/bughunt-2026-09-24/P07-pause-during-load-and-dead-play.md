# P07. Desktop: pause during loading was ignored, and play did nothing after a failed load

**What you'd notice:** on the desktop app, you click a song and press pause while it is still loading. It starts playing anyway, and the button flips back to "playing". When a song fails to load ("Couldn't load"), pressing play does nothing, however many times you press it. The only way to hear the song was to find it and click it again.

**Why it happened:** play and pause only worked on a song the engine already had. While a song was on its way there was nothing to pause, so the press was lost. After a failure the app still thought the song was playing, so the play button actually sent "pause", and the engine had nothing to play anyway.

**What changed:** the engine now remembers whether you last asked for play or pause, and a song that finishes loading follows that. After a failure the app knows nothing is playing, and play loads the song again from where it was meant to start. Files: `apps/desktop/src-tauri/src/audio.rs` (load_track, audio_play, audio_pause, audio_stop), `apps/web/lib/playback/tauriBackend.ts` (error handler), tests in `apps/desktop/src-tauri/src/audio/transport_repro.rs` and `apps/web/lib/playback/tauriBackend.test.ts`.

**Compare:** before = `f81cee6`, after = `10434fd`.
- Test: `cd apps/desktop/src-tauri && cargo test --lib transport_repro`: before, `a_pause_during_a_slow_load_is_kept` fails (`left: Some((true, false))`, the song loaded playing) and `play_after_a_failed_load_tries_the_song_again` fails (`play after the failure did nothing: 1 request(s) to the host`). After, all 6 pass. Full `cargo test --lib`: 65 passed, 2 ignored.
- Test: `cd apps/web && npx vitest run lib/playback/tauriBackend.test.ts`: `reports paused once the engine fails...` fails before (`expected false to be true`), passes after. `npm run test:unit`: 2674 passed.
- Screenshots: not visual.
- Try it yourself: in the desktop app, click a song you have never played (it takes a few seconds) and press pause at once: after the fix it stays paused when it arrives. For the second half, play a song while the host cannot reach YouTube, wait for "Couldn't load", fix the connection, then press play: after the fix it loads and plays.

**Risk:** medium. It changes how play and pause behave around every load, but a song that is already playing is handled exactly as before, and the new tests cover pause, play-after-pause and play-after-failure during a load.
