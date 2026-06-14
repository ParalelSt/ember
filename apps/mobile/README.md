# Ember — Mobile (Capacitor thin client)

Ember is a **Next.js server app** and **cannot be statically bundled**. These
native apps are **thin webview wrappers** that load the **LIVE server URL** via
Capacitor's `server.url`. There is no bundled `dist` — the app just points a
webview at a running Ember server.

- App ID: `app.ember.music`
- App name: `Ember`
- Capacitor: 6.2.x
- Platforms: `android/` (generated), `ios/` (NOT yet generated — needs Xcode)

## Configuration

`capacitor.config.ts` reads the server URL from the `EMBER_APP_URL` env var:

```
EMBER_APP_URL  (default: http://localhost:3000)
```

`webDir` points at `public/` (a tiny "Ember — connecting to server…" fallback
page). Capacitor requires `webDir` to exist even when `server.url` is set; the
fallback is only shown briefly before the live server loads.

### Setting EMBER_APP_URL

`localhost:3000` only works in an emulator-less Mac context. **A physical phone
cannot reach `localhost`** — on the phone, localhost is the phone itself.

On a real device, set `EMBER_APP_URL` to one of:

- **Tailscale funnel URL (preferred, https):** `https://ember.<tailnet>.ts.net`
- **Mac LAN IP (http, needs cleartext):** `http://192.168.x.x:3000`

```bash
EMBER_APP_URL="https://ember.<tailnet>.ts.net" npm run sync
```

> Tailscale is the preferred path because the funnel serves **https**. The
> http LAN-IP path also works (cleartext is enabled — see below), but https is
> preferred for production-like behavior and to avoid mixed-content issues.

## Scripts

```
npm run sync         # cap sync (copies config + plugins into native projects)
npm run sync:ios     # cap sync ios
npm run open:android # open the Android project in Android Studio
npm run run:android  # build & run on a connected device/emulator
npm run open:ios     # open the iOS project in Xcode
```

There is **no web build step** — nothing is bundled. `sync` only pushes the
config (incl. `EMBER_APP_URL`) and the fallback `public/` page into the native
projects, so re-run `sync` whenever you change `EMBER_APP_URL`.

## Android cleartext

For an `http://` dev URL (localhost / LAN IP), cleartext is enabled:

- `capacitor.config.ts` sets `server.cleartext: true` and
  `android.allowMixedContent: true`.
- `android/app/src/main/AndroidManifest.xml` declares
  `android:usesCleartextTraffic="true"` so cleartext http works in all build
  types (not just debug). The `INTERNET` permission is already present.

Cleartext to an http LAN URL works, but the **https Tailscale funnel URL is
preferred**.

## Prerequisites

### Android

The Android SDK must be installed and `ANDROID_HOME` set before you can
**build/run** (`open:android` / `run:android`). `cap sync` itself does NOT need
the SDK. One-time setup:

1. Install the Android SDK via **Android Studio** (SDK Manager).
2. Set the env var (zsh):
   ```bash
   echo 'export ANDROID_HOME="$HOME/Library/Android/sdk"' >> ~/.zshrc
   echo 'export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"' >> ~/.zshrc
   source ~/.zshrc
   ```
3. Ensure `android/local.properties` has `sdk.dir=/Users/<you>/Library/Android/sdk`
   (Android Studio usually writes this on first open).

### iOS (one-time, AFTER installing Xcode)

The `ios/` project does **not exist yet** because full **Xcode** is not
installed (only CommandLineTools). CocoaPods is installed. After installing
Xcode from the App Store and running `sudo xcode-select -s /Applications/Xcode.app`,
generate the iOS project once:

```bash
cd apps/mobile
npx cap add ios
npx cap sync ios
```

Then `npm run open:ios` to open it in Xcode. Remember to set `EMBER_APP_URL`
(the Tailscale funnel URL) before syncing for a physical iPhone.

## Monorepo note (rare `cap` resolution issue)

This is an npm workspace (`workspaces: ["apps/*"]`). `apps/web` pulls in
`semver@6` transitively (hoisted to the root `node_modules`), while
`@capacitor/cli` needs `semver@7` (it ships its own nested copy). A clean
`npm ci` / `npm install` on macOS/Linux links `node_modules/.bin/cap` as a
**symlink**, which resolves the CLI's nested `semver@7` correctly — so
`npm run sync` etc. work normally.

If npm ever materializes `.bin/cap` as a plain copy instead (it has been seen
mid-install), the shim resolves the root `semver@6` and fails with
`Cannot find module 'semver/functions/satisfies'`. The robust fix is to invoke
the CLI by its real path (immune to the shim type) — this is exactly what CI
does:

```bash
# from apps/mobile
node ../../node_modules/@capacitor/cli/bin/capacitor sync android
```
