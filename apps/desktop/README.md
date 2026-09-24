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

## Auto cache of upcoming songs

So a dropped connection does not stop the music, the web app keeps the next
two songs of the queue on disk (what and when is decided by
`apps/web/lib/autoCache/policy.ts`; the desktop storage is
`src-tauri/src/cache.rs`, reached through `apps/web/lib/autoCache/tauriAdapter.ts`).

| OS | Folder |
|---|---|
| macOS | `~/Library/Caches/app.ember.desktop/audio-cache` |
| Windows | `%LOCALAPPDATA%\app.ember.desktop\cache\audio-cache` |
| Linux | `~/.cache/app.ember.desktop/audio-cache` |

Capped at 500 MB and 100 songs; the least recently played song goes first,
never the one playing. Each download is written to a `.part` file and renamed
only once complete, and `index.json` (also written via a temp file) records
each song's size and when it was last played. Settings > Downloads shows the
size and clears it. When a cached copy exists, `audio_load` plays the file
instead of streaming (its `cacheKey` argument is the track id); a copy that
will not decode is deleted and the song streams.

Commands (all in `permissions/app-commands.toml`): `cache_prefetch` (`url`,
`key`, `cookie`), `cache_cancel`, `cache_has` (`key`), `cache_keys`,
`cache_path` (`key`), `cache_touch` (`key`), `cache_evict` (`keys`),
`cache_stats`, `cache_clear`. An older build refuses them ("not allowed by
ACL"), which the web app reads as "automatic caching unavailable, update the
app".

## Voice search

The mic in the search box uses the operating system's own recognizer; the
WebView's `webkitSpeechRecognition` is never used inside the app (WebView2
exposes it but every session fails with `network`, WKWebView has none).
The web app talks to Rust through four commands, `speech_available`,
`speech_start` (`lang`), `speech_stop` and `speech_abort`, and listens for
`speech:partial` / `speech:final` (`{ text }`), `speech:error`
(`{ kind, detail }`) and `speech:end`. All four commands are listed in
`permissions/app-commands.toml`: without that the remote origin gets "not
allowed by ACL", which the web app shows as "Update the Ember app to use voice
search." (the same toast an older desktop build gets).

| | Recognizer | Needs |
|---|---|---|
| macOS | `SFSpeechRecognizer` + `AVAudioEngine`, on the device where Apple has the language model, Apple's server otherwise | Speech Recognition and Microphone permission (two prompts on first use) |
| Windows | `Windows.Media.SpeechRecognition` dictation | Settings, Privacy & security, Speech: **Online speech recognition** on; Microphone: **Let desktop apps access your microphone** on |
| Linux | none (the mic toast says voice search isn't available on this device) | |

**macOS bundle requirements.** macOS only grants the mic and speech to a
validly signed bundle that declares why it wants them:

- `src-tauri/Info.plist` (merged into the bundle's plist) carries
  `NSMicrophoneUsageDescription` and `NSSpeechRecognitionUsageDescription`.
- `src-tauri/entitlements.plist` carries `com.apple.security.device.audio-input`;
  the hardened runtime blocks the mic without it.
- `tauri.conf.json` sets `bundle.macOS.signingIdentity` to `"-"` (ad-hoc).
  Before this the bundle had only the linker's signature on the binary and none
  on the bundle ("code has no resources but signature indicates they must be
  present"), which TCC refuses and which also crashed NSOpenPanel (the bug
  report screenshot picker). A real Developer ID from `APPLE_SIGNING_IDENTITY`
  (CI, `scripts/build-mac.sh`) is what release builds should sign with; the
  build output's "Signing with identity ..." line says which one was used.
  Ad-hoc bundles still need right-click, Open on other Macs.

Check a built bundle:

```sh
cd src-tauri/target/release/bundle/macos
codesign --verify --deep --strict --verbose=2 Ember.app      # valid on disk, satisfies its Designated Requirement
codesign -d --entitlements - Ember.app | grep audio-input
plutil -p Ember.app/Contents/Info.plist | grep Usage
```

**Windows.** Dictation is a cloud grammar, so `onDevice` is always false and
the **Online speech recognition** privacy switch must be on; when it is off
the app says exactly that ("Turn on Online speech recognition in Windows
Settings ..."). The desktop log records `speech: available=<bool> onDevice=<bool>`
at startup.

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
