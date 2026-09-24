# Ember native apps — build, sign, install

The Android and desktop apps are **thin webview shells around the live server**
(they load `EMBER_APP_URL`; nothing is bundled). Native extras: background
audio + media notification on Android, Rust audio + media keys on desktop.
Voice search in both uses the OS recognizer (Android `SpeechRecognizer`,
macOS `SFSpeechRecognizer`, Windows `Windows.Media.SpeechRecognition`): see
the "Voice search" sections in `apps/desktop/README.md` and `apps/mobile/README.md`.

## Get builds from CI (easiest)

Before tagging, set `tauri.conf.json`, `Cargo.toml` and `build.gradle`
(`versionName`, `versionCode + 1`) to the app version in
`apps/web/package.json` (docs/changelog-system.md, section 5).

Push a tag like `v0.3.0` (or run the **native-build** workflow manually):
- **Desktop**: .dmg (macOS), .msi/.exe (Windows), .AppImage/.deb (Linux) —
  attached to the draft GitHub Release on tags, or as workflow artifacts.
- **Android**: `ember-android-apk` workflow artifact (attach it to the release
  manually if wanted).

One-time GitHub setup: repo **variable** `EMBER_APP_URL` =
`https://ember.tailf4de41.ts.net`. Optional (proper APK signing): secrets
`ANDROID_KEYSTORE_B64` (`base64 -i apps/mobile/android/ember-release.keystore`)
and `ANDROID_KEYSTORE_PASSWORD` (from `apps/mobile/android/keystore.properties`).

## Local builds

```bash
# Android (signed release APK if keystore.properties exists, else debug-signed)
cd apps/mobile
EMBER_APP_URL="https://ember.tailf4de41.ts.net" npx cap sync android
cd android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk

# Desktop (current OS)
cd apps/desktop
EMBER_APP_URL="https://ember.tailf4de41.ts.net" npm run build
# → src-tauri/target/release/bundle/…
```

## Android Auto (Android app)

Ships in the APK; nothing to configure. Playback on Android is the native
Media3 player (`EmberPlaybackService`), which is also the media browser the
car talks to. A sideloaded build only appears in the car after enabling
**Unknown sources** in the Android Auto app's developer settings (tap the
version number ~10 times → ⋮ → Developer settings). Testing recipes:
`apps/mobile/ANDROID_AUTO.md`.

## Discord status (desktop app)

The desktop app sets **each user's own** Discord status (the server can only
ever set the host's — Discord needs a local client, which browsers can't reach).

It needs the Discord application id baked in at build time:

```bash
cd apps/desktop
DISCORD_APP_ID=your-app-id EMBER_APP_URL="https://ember.tailf4de41.ts.net" npm run build
```

In CI, add a repo variable `DISCORD_APP_ID` — the workflow already passes it
to the desktop build step. **Without it, rich presence silently does nothing**:
`app_id()` reads it via `option_env!` at COMPILE time, so a build made without
the variable set can never connect to Discord, no matter what the user does in
Settings. Every release up to 0.2.3 shipped that way.
Without it the feature is silently off (playback is unaffected). Users also
need the Discord desktop app running; if it's closed, Ember reconnects on the
next track change.

## Building the macOS app

```bash
cd apps/desktop
npm run build:mac          # loads the live server (Tailscale funnel)
npm run build:mac:local    # loads http://localhost:3000
```

Signs with your Developer ID automatically, notarizes if credentials are
stored, and prints the `open` command plus the log path when it finishes.

**Which to use.** The desktop app is a thin shell that DOWNLOADS the web app
from whatever server you point it at, so web-side changes only show up if that
server runs them:

- `build:mac` → your friend's deployed code. The real app, but no unreleased fixes.
- `build:mac:local` → run `./start-static.sh` from the repo root first, then this.
  Loads YOUR machine's server, so it includes whatever is on your current branch.
  This is the one to use when testing desktop changes.

**Debugging a packaged build:** right-click inside the window → *Inspect
Element* (devtools are enabled in release), and check
`~/Library/Logs/Ember/ember-desktop.log`.

**Note on the DMG:** creating it drives Finder through AppleScript, so it only
works from a normal Terminal — not from CI or an agent shell. The `.app` builds
fine either way and is all you need to run it yourself.

## iOS

The project exists and builds. Requires Xcode + CocoaPods (both installed).

```bash
cd apps/mobile
EMBER_APP_URL="https://ember.tailf4de41.ts.net" npx cap sync ios
npx cap open ios          # opens Xcode; pick a device/simulator and hit Run
```

Or straight to a simulator without Xcode's UI:

```bash
cd apps/mobile/ios/App
xcodebuild -workspace App.xcworkspace -scheme App -sdk iphonesimulator \
  -configuration Debug -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
xcrun simctl install booted "$HOME/Library/Developer/Xcode/DerivedData/App-*/Build/Products/Debug-iphonesimulator/App.app"
xcrun simctl launch booted app.ember.music
```

`UIBackgroundModes=audio` is set, which is what lets playback continue when the
app is backgrounded. Portrait-locked, same as Android.

**Getting it onto a real iPhone.** A free Apple ID signs an app that lasts
**7 days**, then it stops opening and must be reinstalled. For anything
longer-lived — or to give it to friends via TestFlight — you need the Apple
Developer Program ($99/yr). Ember will never be App Store material (it plays
YouTube-sourced audio), so TestFlight is the realistic ceiling.

## Signing the macOS app

Your Developer ID certificate is already in the keychain
(`Developer ID Application: ARON MATOIC (8B8D2GSC9U)`), so a signed build is:

```bash
cd apps/desktop
npm run build:signed
```

That picks the certificate up automatically and bakes in the funnel URL.

### Notarization — the missing half

Signing alone still makes other Macs say *"unidentified developer"*. Apple has
to notarize the app too. One-time setup:

1. Create an **app-specific password** at https://appleid.apple.com →
   Sign-In and Security → App-Specific Passwords.
2. Store it once:

```bash
xcrun notarytool store-credentials "AC_PASSWORD" \
  --apple-id you@example.com \
  --team-id 8B8D2GSC9U \
  --password <the-app-specific-password>
```

After that `npm run build:signed` notarizes automatically. Verify a finished
build with:

```bash
spctl -a -vvv -t install src-tauri/target/release/bundle/macos/Ember.app
```

`accepted` means other Macs will open it without warnings.

### In CI

Add these repo secrets and the workflow signs macOS builds itself
(all optional — without them the build still succeeds, just unsigned):
`APPLE_CERTIFICATE` (base64 of an exported .p12), `APPLE_CERTIFICATE_PASSWORD`,
`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`.

## Signing key (Android) — IMPORTANT

`apps/mobile/android/ember-release.keystore` + `keystore.properties` live ONLY
on the dev Mac (gitignored). **Back the keystore up** — Android updates must be
signed with the same key, or users must uninstall/reinstall. Regenerate (new
identity) with:

```bash
cd apps/mobile/android
keytool -genkeypair -keystore ember-release.keystore -alias ember \
  -keyalg RSA -keysize 2048 -validity 10000
cp keystore.properties.example keystore.properties   # fill in the password
```

## Offline downloads (Android)

Android builds can pin a playlist or Liked Songs for offline playback: the
`EmberOffline` Capacitor plugin downloads audio (and artwork) to app-private
storage and a downloaded track plays locally even while online. On a cold
start with no server reachable (or a main-frame 4xx/5xx from a reachable
one), the app falls back to a small bundled page listing what is already
downloaded, with lock-screen controls, instead of a blank screen. See
`apps/mobile/README.md`'s "Offline (Android only)" section for the file
layout, the plugin surface, and how to test it (including an emulator
airplane-mode recipe). iOS and desktop do not have pinned downloads yet;
in a browser, Download keeps songs in the browser's own storage (OPFS) and
they play from there.

## Auto cache of upcoming songs (web 0.7.4, shells 0.4.3)

Every platform keeps the song playing and the next two on the device, so a
dropped connection does not stop the music. Offline, songs without a copy
are skipped with an Offline badge; when nothing is left the music pauses
and the song it stopped at is loaded (paused) once the network is back.
One policy decides what and when (`apps/web/lib/autoCache/policy.ts`,
mirrored in Kotlin); the host treats these downloads as low priority
(`?prefetch=1`, see `docs/prefetch.md`).

| Platform | Where | Cap | Needs |
|---|---|---|---|
| Browser | OPFS `cache/audio/` | 250 MB or half the browser's quota | nothing (a browser without OPFS says "not available") |
| Desktop app | OS cache dir, `audio-cache` (see `apps/desktop/README.md`) | 500 MB, 100 songs | desktop app 0.4.3 |
| Android app | Media3 cache, `media3-audio` in the app cache (see `apps/mobile/README.md`) | 300 MB | APK 0.4.3 (versionCode 8); keeps working with the screen off and in Android Auto |

Settings > Downloads has "Cache upcoming songs" (on by default), "Also on
mobile data" (off by default), the space used and "Clear cached songs". An
older desktop app or APK shows "update the app" there instead and plays as
before. Pinned downloads are a separate store and are never evicted by it.

## Installing

**Android (sideload):** send the APK (Discord/Drive/USB) → open it on the
phone → allow "install unknown apps" for the browser/file manager when asked.
Play Protect may warn (unknown developer) — "install anyway".

**macOS:** open the .dmg, drag Ember to Applications. First launch:
right-click → Open (unsigned app; once per install). No Apple Developer
account = no notarization, which is fine for friends-and-family.

**Store distribution is intentionally off the table** — YouTube-sourced audio
would not pass store review. Sideload/direct download only.

## iOS — not yet

Needs Xcode on the Mac (`npx cap add ios`, native speech/audio plugins,
Apple Developer account for anything beyond a 7-day dev install). See
docs/superpowers/specs — Part 3b.
