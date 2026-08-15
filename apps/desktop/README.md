# Ember Desktop (Tauri 2)

A thin native desktop shell for **Ember**. The window is a system webview that
loads the **live Ember server URL** — it does **not** bundle the web UI (Ember is
a server app). Audio plays through Ember's existing web `<audio>` backend inside
the webview; native desktop audio / media keys are a later workstream.

## How it works

The main window's target URL is read from the `EMBER_APP_URL` env var
(default `http://localhost:3000`). Tauri 2 reads the window URL from
`src-tauri/tauri.conf.json` at config-load time and does not interpolate env
vars there, so `scripts/set-url.mjs` writes the resolved URL into
`tauri.conf.json` before `tauri dev` / `tauri build` (wired into the `dev` and
`build` npm scripts). Identifier `app.ember.desktop`, window 1200x800, resizable.

## Prerequisites

- **Rust** (stable) + Cargo — install via <https://rustup.rs>.
- **Node** (used only for the Tauri CLI + the URL-injection script).
- macOS system WebView (built in). Linux needs `webkit2gtk`; Windows needs
  WebView2 (handled by CI in a later workstream).

## Install

```sh
cd apps/desktop
npm install
```

## Run (local dev)

1. Start the Ember server (from the repo root) so `http://localhost:3000` is up:

   ```sh
   ./start-static.sh
   ```

2. In another terminal, launch the native window:

   ```sh
   cd apps/desktop
   npm run dev          # = set-url + `tauri dev`
   ```

   The first Rust compile takes several minutes; subsequent runs are fast.

## Point at a remote URL (e.g. the Tailscale funnel)

```sh
EMBER_APP_URL=https://ember.<your-tailnet>.ts.net npm run dev
# or for a packaged build:
EMBER_APP_URL=https://ember.<your-tailnet>.ts.net npm run build
```

If `EMBER_APP_URL` is unreachable, the webview shows its native "can't reach"
page — make sure the server is running first.

## Build a macOS .dmg

```sh
cd apps/desktop
npm run build          # = set-url + `tauri build`
```

Output lands in `src-tauri/target/release/bundle/`. The `.dmg` is **unsigned**
in this workstream; signing/notarization is handled by distribution CI later.

## Windows / Linux builds

**You cannot build these on the Mac.** Tauri needs each platform's native
toolchain, and cross-compiling to Windows dies in `aws-lc-sys`, which compiles
C and wants MSVC. Builds come from CI instead
([`.github/workflows/native-build.yml`](../../.github/workflows/native-build.yml)):

- **push to `feat/windows-desktop`** → builds Windows only (cheap: the repo is
  private, so minutes are billed, and macOS bills at 10x)
- **push a `v*` tag** → builds macOS + Linux + Windows and attaches them to a
  draft GitHub Release

Grab the installer from the run's **Artifacts** section (`gh run download <id>`).
Windows produces both an NSIS `.exe` and an MSI.

The server URL is baked in from the repo variable `EMBER_APP_URL`
(Settings → Secrets and variables → Actions → Variables).

⚠️ The Windows build is **unsigned**, so SmartScreen shows "Windows protected
your PC" on first run — *More info* → *Run anyway*. Silencing that needs an
Authenticode certificate, which costs real money per year.

### Platform feature parity

| | macOS | Windows | Linux |
|---|---|---|---|
| Native audio (rodio) | ✓ | ✓ | ✓ |
| OS media controls | ✓ Now Playing | ✓ SMTC *(untested)* | ✓ MPRIS |
| Discord presence | ✓ | ✓ | ✓ |

Windows SMTC was wired by resolving the window HWND (souvlaki panics on a
missing one, so it's resolved up front and a failure degrades to "no media
controls" rather than a crash). It compiles in CI but **has not been run on a
Windows machine** — media keys and the Now Playing flyout are unverified.
