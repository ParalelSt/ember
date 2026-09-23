# A2. Windows desktop: the auto-updater quit the app in the middle of a song

**What you'd notice:** on Windows, a minute or so after opening Ember while a new version is out, the app suddenly closes mid-song, an installer flashes up, and Ember opens again from scratch.

**Why it happened:** at launch the app downloads an update and installs it straight away. On a Mac that is harmless (the new version waits on disk for the next launch), but on Windows the update library starts the installer and ends the app on the spot, whatever is playing.

**What changed:** on Windows the update is now only downloaded at launch and kept on disk. At the NEXT launch, if nothing is playing yet, it is re-checked against the release signature and installed, which restarts Ember into the new version. If you are already playing by then, it waits another launch. Installing on quit was not used because the installer reopens Ember, so closing the app would bring it straight back. Mac and Linux behave exactly as before. Files: `apps/desktop/src-tauri/src/update.rs`, `src/audio.rs` (is_playing), `Cargo.toml` (two small crates the updater already used).

**Compare:** before = `bc49d68`, after = `9f79a8c`.
- Test: `cd apps/desktop/src-tauri && cargo test --lib update::`: with the old "install at once everywhere" rule, 4 of 8 fail (`left: DownloadAndInstall, right: DownloadAndStage`, i.e. Windows would still install and quit); after, 8 pass. `cargo test --lib is_playing_counts_only_music_playing_or_about_to` passes. Full `cargo test --lib`: 75 passed, 2 ignored.
- Screenshots: not visual.
- Not tested here: a real Windows install. The quit happens inside the update library and needs a Windows machine with a newer release published. What is tested is the decision (download, keep, install next launch, wait while playing), keeping the download on disk, and the signature re-check with a throwaway key.
- Try it yourself: on Windows, publish a newer desktop release, open Ember and play a song: it keeps playing (the log says "downloaded, installs next launch"). Close and reopen Ember: it restarts once into the new version.

**Risk:** medium. Windows updates now land one launch later, and this path cannot run on a Mac; if something goes wrong it logs and leaves the current version running.
