# L3. A shipped desktop build trusted any app on the user's own localhost:3000

**What you'd notice:** nothing under normal use. But once someone installed the signed Ember desktop app (pointed at the real server), any other program on their machine that could bind to port 3000 would be granted the same native powers the Ember webview has: native audio control, Discord presence, and reading the app's own logs.

**Why it happened:** the build script that writes the desktop app's IPC allow-list (`capabilities/default.json`) always added `http://localhost:3000` to it "for dev convenience," on top of whatever server the app actually loads. That was fine for `npm run dev`, but it also landed in signed release builds pointed at the real server, and in the file checked into git.

**What changed:** the allow-list now lists only the origin the window actually loads (`scripts/set-url.mjs`), and the checked-in default reflects that safe, real-server-only state. `npm run dev` and `build-mac.sh --local` are unaffected because they already resolve to `http://localhost:3000` as that one allowed origin. Files: `apps/desktop/scripts/set-url.mjs`, `apps/desktop/src-tauri/capabilities/default.json`.

**Compare:** before = `0c273a5`, after = `c654fd1`.
- Test: `CARGO_TARGET_DIR=.../stream-stall/apps/desktop/src-tauri/target cargo test --lib capability_tests` (from `apps/desktop/src-tauri`): `shipped_capability_does_not_trust_the_local_dev_server` fails before (`[String("http://localhost:3000"), String("https://ember.tailf4de41.ts.net")]`), passes after: `test result: ok. 2 passed`.
- Screenshots: none, not visual.
- Try it yourself: needs a signed build and a second local process on port 3000 to actually observe; the JSON in `apps/desktop/src-tauri/capabilities/default.json` is the easiest thing to check by eye.
**Risk:** low, this only narrows what the shipped app trusts; every existing legitimate use (dev, `--local` builds, the real server) still resolves to exactly the one origin it needs.
