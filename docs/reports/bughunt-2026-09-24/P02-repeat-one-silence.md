# P02. Desktop: "repeat one" played silence after the first time through

**What you'd notice:** on the desktop app with repeat set to "one", the song plays once. Then the player says it is playing, the slider sits at 0:00, and there is no sound. Pressing Previous after a song has ended did the same.

**Why it happened:** when a song ends, the app asks the audio engine to jump back to the start and play. By then the engine had used up the song it was holding, and jumping inside a used-up song is quietly accepted and does nothing.

**What changed:** a jump in a song that has already played to its end now loads the song again from that point, the same way the engine already handled a jump backwards in a streamed song. Files: `apps/desktop/src-tauri/src/audio.rs` (audio_seek), `apps/desktop/src-tauri/src/audio/transport_repro.rs` (new test).

**Compare:** before = `fd91d46`, after = `e5a5d26`.
- Test: `cd apps/desktop/src-tauri && cargo test --lib transport_repro`: `repeat_one_plays_the_song_again_after_it_ends` fails before with `the repeat never got past 0.0s`, passes after (the song plays through a second time). Full `cargo test --lib`: 62 passed, 2 ignored.
- Screenshots: not visual.
- Try it yourself: in the desktop app, play a short song you have played before, set repeat to "one", and let it finish. Before, it went silent at 0:00. After, it starts again with sound.

**Risk:** low. It only changes a jump made after the song has ended, which did nothing before.
