# A6. Desktop: with the server out of reach at launch, the window stayed dead

**What you'd notice:** open the desktop app while the Ember server is down, the computer is offline, or Tailscale is not connected yet. The window stayed blank white (or showed the browser's error page) with nothing to click, even after the server came back. The only fix was to quit Ember and open it again.

**Why it happened:** the window loads the server straight off the network, and nothing in the app noticed when that load failed or tried again.

**What changed:** at launch the app checks the server itself. If there is no answer, the window shows a small page bundled inside the app: "Can't reach Ember, retrying..." with a Retry button. The app keeps trying (after 2, 4 and 8 seconds, then every 15), Retry tries at once, and the window loads Ember as soon as the server answers. When the server is up, launch is exactly as before. Files: `apps/desktop/src-tauri/src/connect.rs` (new), `offline/index.html` (the page), `tauri.conf.json` (bundles the page), `permissions/app-commands.toml` and `src/lib.rs` (the Retry command).

**Compare:** before = `8ddae7b`, after = `05a2548`.
- Test: `cd apps/desktop/src-tauri && cargo test --lib connect::`: before, `the_retry_page_is_bundled` fails (`tauri.conf.json build.frontendDist: no bundled page`); after, all 9 pass (reachability, retry timing, Retry button waking the loop, the server coming back). Full `cargo test --lib`: 84 passed, 2 ignored.
- Real app check on this Mac: a build pointed at a closed local port logged `can't reach http://127.0.0.1:47123/ at launch: showing the retry page`; starting a web server on that port 29 s later logged `reachable again: loading it`, and the window showed that server's page.
- Screenshots: shots/A6-before.png (blank white window) vs shots/A6-after.png (the Retry page).
- Try it yourself: quit Ember, turn Wi-Fi off (or quit Tailscale), open Ember: the Retry page shows. Turn Wi-Fi back on: within 15 s (or at once with Retry) Ember loads.

**Risk:** low. It only acts when the server does not answer within 10 s at launch; the page is plain HTML with no access beyond a Retry call. Not checked on Windows, where the page address differs (`http://tauri.localhost/`, covered by a test).
