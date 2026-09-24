# Android: system navigation buttons over Ember's bottom controls

Branch `android-insets` (from main at fbfc4ab). There's no version bump here: it ships with the next batch.

## What the friend sees

Android's own back, home and recents buttons (or the gesture pill) are drawn on top of Ember's bottom controls. The friend's reports come from a `moto e7 plus`, `Android 15` (build AP4A.250205.002, so a custom ROM), with WebView `Chrome/134`.

## Cause

The shell targets SDK 35. Android 15 forces edge-to-edge on those apps, so the WebView is laid out under the status bar and the navigation bar. The WebView reports `env(safe-area-inset-bottom)` as 0 for the navigation bar. Measured on an API 35 emulator (WebView 124): `env()` is 0 in both navigation modes.

The first fix (9eb5c07 + 2a9ca17, 2026-09-21, first shipped in shells 0.4.0) handled this correctly, but only in part:

1. **Native half: works.** `MainActivity` reads the window insets and publishes `--ember-inset-*` on `<html>`. On the emulator, a main build publishes a 48px bottom inset with three-button navigation and 24px with the gesture pill. It survives cold starts and updates live when the navigation mode changes. Nothing in the Capacitor or CoordinatorLayout tree swallows the insets, and Capacitor's `adjustMarginsForEdgeToEdge` defaults to `disable` in 7.6.8. The document-start script is available on WebView 134.
2. **Only the nav and the phone bar used it.** The rest of the bottom UI didn't. Screenshot evidence on the emulator (API 35, three-button, a main build): the hamburger drawer's account row sat under the system buttons, and its header sat under the status bar. The other surfaces that never used the inset:
   - the queue sheet and the Copy to… sheet (`SheetContent`);
   - the import review sheet;
   - the tab list sheet;
   - toasts;
   - Back to top, which was pinned to a fixed height while the bars under it grew by the inset;
   - the bundled offline page (`offline.html`, which used `env()` only).
3. **The server's CSS lagged behind the APK.** The friend's automatic reports on 2026-09-23 carry web `0.3.10 (d022bcd, 2026-09-20)`. That build doesn't have 2a9ca17, so the page ignored `--ember-inset-bottom` even on a fixed APK. The reports don't record the APK version, and APKs never update themselves. So an older-than-0.4.0 install is possible too.

## Fix

- **Web.** Every surface that touches an edge now pads by `--safe-bottom` / `--safe-top`, which is `max(env(), var(--ember-inset-*))`. That covers:
  - `SheetContent`, on each side it touches, scoped by `data-side` so a call site's `p-0` can't cancel it. The close button also moves below the status bar.
  - the import review sheet, the tab list sheet and Back to top (including its Copy to… position);
  - the sonner toasts;
  - `offline.html`.

  Web, iOS PWA and desktop are unaffected: both sources are 0px there.
- **Native, hardening.**
  - The inset script keeps its values on `window.__emberInsets`. A MutationObserver puts them back if anything rewrites `<html>`'s style attribute (for example, React re-creating the root's attributes after a failed hydration). The native side only re-sends insets when they change, so without this the values would be lost.
  - The last insets are also re-applied at the end of every page load (a Capacitor `WebViewListener`), on top of the document-start script.
  - The insets are passed on to the WebView's own handler. Newer WebViews can then fill `env()` themselves, and the CSS takes the larger value, so the two never add up.
  - The listener logic moved into `SafeAreaInsets.install`, so Robolectric can test it.
  - `ThemeColors.applyToWindow` turns off the navigation bar contrast scrim. The strip under the three buttons then shows the app's own bar colour instead of a grey band. Theme icon colours still apply.

## Proof

- Robolectric, SDK 34 and 35 (`SafeAreaInsetsWindowTest`):
  - three-button (48) and gesture (24) insets;
  - a cutout deeper than the status bar;
  - the keyboard is ignored;
  - a mode switch republishes;
  - the insets are passed on unconsumed;
  - in Capacitor's real layout (AppCompat + CoordinatorLayout + CapacitorWebView), the insets reach the WebView on 35 and are consumed by the decor on 34.

  `SafeAreaInsetsTest` pins the script byte for byte. `ThemeColorsSdk35Test` covers the scrim and bar colours on 35.
- `tests/android-insets-ui.test.mjs` (22 checks, 390x844, the shell's own script with a 48px bottom and 24px top): the bottom nav, the phone player bar, Back to top, the Copy to… bar and sheet, the drawer and the queue sheet all stand clear. The inset survives a client-side navigation and a rewrite or removal of `<html>`'s style. With no inset, nothing moves.
- `tests/offline-page.test.mjs` (+5): the offline header and player bar stand off the insets.
- `lib/lintRules.test.ts`: each surface spends the tokens.
- Emulator, the new APK with the new web build: the drawer header clears the clock, the account row clears the buttons, and the offline page's bar pads to 60px.
- Test runs:
  - `./gradlew testDebugUnitTest assembleDebug`: 291 tests, 0 failures.
  - `npm run test:unit`: 3210 passed.
  - `next typegen` and `tsc --noEmit`: clean.
  - `playlist-copy-ui`: 96/96. `mobile-player-ui`: 101/101.

## What the friend must do

1. **The host must run this web build** (`update.sh`). The web half is most of the fix, and it reaches the phone without a reinstall.
2. **Install the new APK** from this batch, over the old one. An APK older than shells 0.4.0 publishes no insets at all, and no web change can fix that.

## What to check on the phone

With three-button navigation (Settings > System > Navigation), then again with gestures:

- The bottom nav's Home, Search and Library icons sit fully above the back, home and recents buttons. The strip under the buttons is the nav's own colour, not a song row and not a grey band.
- With a song playing, the phone player bar sits on top of the nav, clear of the buttons.
- The ☰ drawer: the "Ember" header is below the clock, and your name row at the bottom is above the buttons.
- The full-screen player > Queue: the last row and the header are clear of both bars.
- A playlist > Select > pick a song: the Copy to… bar is above the player bar. Tap Copy to…: the last destination is above the buttons.
- Scroll a long page: Back to top floats above the player bar.
- Airplane mode, then a cold start: on the offline page, the title is below the clock and the player bar's controls are above the buttons.
- Switch between gesture and three-button navigation while the app is open: everything moves with it.

If the nav still sits under the buttons after both installs, send a bug report from the phone. The report's context line shows the web version the phone loaded, which should be this batch's.
