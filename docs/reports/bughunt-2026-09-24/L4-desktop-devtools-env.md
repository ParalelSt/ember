# L4. EMBER_DEVTOOLS=1 did nothing on the desktop app

**What you'd notice:** setting `EMBER_DEVTOOLS=1` and launching the desktop app was supposed to pop devtools open automatically for debugging. It never did — nothing happened, silently.

**Why it happened:** the code that opens devtools on launch was gated behind `#[cfg(feature = "devtools")]`, but that's a crate-level Cargo feature the desktop app's own `Cargo.toml` never defines (there's a *different* `devtools` feature enabled on the `tauri` dependency itself, for the always-on right-click → Inspect Element, which is unrelated). So that whole block was permanently dead code — clippy already flagged it as an unexpected cfg.

**What changed:** the launch check now uses the build profile (debug vs release) instead of a feature that never existed, so `EMBER_DEVTOOLS=1` opens devtools on launch in debug builds and is compiled to a no-op in release builds, which is what was intended. Files: `apps/desktop/src-tauri/src/lib.rs`.

**Compare:** before = `8413dca`, after = `6b500cf`.
- Test: `CARGO_TARGET_DIR=.../stream-stall/apps/desktop/src-tauri/target cargo test --lib devtools_tests` (from `apps/desktop/src-tauri`): `opens_in_a_debug_build_when_asked` fails before (`assertion failed: wants_devtools_on_launch(true, Some("1"))`), passes after: `test result: ok. 3 passed`. Also confirmed `cargo clippy --lib` no longer reports the unexpected-cfg warning.
- Screenshots: none, not visual (devtools window itself is a native OS panel).
- Try it yourself: `EMBER_DEVTOOLS=1 npm run dev` in `apps/desktop` — devtools should now pop open with the app.
**Risk:** low, debug-only developer convenience; release builds are unaffected either way.
