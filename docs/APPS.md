# Ember native apps — build, sign, install

The Android, iPhone and desktop apps are **thin webview shells around the live server**
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
- **iPhone**: TestFlight, once set up (see "TestFlight" below); off until the
  repo variable `BUILD_IOS` is `true`.

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

## iOS (iPhone app)

A thin Capacitor shell like Android, iPhone only (portrait), bundle id
`app.ember.music`, team `8B8D2GSC9U`. Requires Xcode + CocoaPods.

```bash
cd apps/mobile
EMBER_APP_URL="https://ember.tailf4de41.ts.net" npx cap sync ios   # config + pod install
npx cap open ios          # Xcode: pick a device/simulator and hit Run
```

Simulator without Xcode's UI (and the native unit tests):

```bash
cd apps/mobile/ios/App
xcodebuild -workspace App.xcworkspace -scheme App -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 17' test      # AppTests
xcrun simctl install booted ~/Library/Developer/Xcode/DerivedData/App-*/Build/Products/Debug-iphonesimulator/App.app
xcrun simctl launch booted app.ember.music
```

**What the iPhone app is.** No native player: songs play through the page's
web audio backend inside WKWebView (`capacitorBackend`, with no plugin on
iOS). What the shell adds:

- **Background audio / lock screen.** `UIBackgroundModes=audio` plus the
  `playback` audio session category, set at launch (`AudioSession.swift`), so
  music keeps going with the screen locked or the app in the background and
  the silent switch does not mute it. The lock screen and Control Center
  show title, artist, artwork and play/pause/next/previous/seek from
  `navigator.mediaSession`, which WKWebView publishes itself. Checked on the
  iOS 26 simulator: plays locked, and the next song starts while locked.
- **No npm plugins on iOS** (`ios.includePlugins: []` in
  `capacitor.config.ts`): the media-session plugin's iOS half fires every
  handler the moment it is registered and never delivers the real buttons.
  The web side also refuses to call it on iOS.
- **Theme** (`EmberThemePlugin.swift`, same `EmberTheme.apply` call as
  Android): status bar text follows the theme's light/dark scheme, and the
  blank before the first byte is the last theme's background.
- **App Transport Security** like Android's cleartext rule: the
  `Configure App Transport Security` build phase
  (`ios/App/scripts/configure-ats.sh`) rewrites the built Info.plist from the
  synced server URL. https server: no exception at all. http server with a
  name: an exception for that host only. http IP, `localhost` or `.local`:
  `NSAllowsLocalNetworking` (iOS exempts these from ATS anyway, so an IP build
  cannot be narrowed further). Test: `node tests/ios-ats.test.mjs`.

**Not on iOS:** CarPlay, offline pins, voice search (the mic says so), party
volume and loudness normalization (iOS does not let a page set volume;
the hardware buttons do), and the equalizer costs background playback the
same way it does in a phone browser. The bundled offline page only says
"Connecting to server…" when the server is unreachable.

### TestFlight (friends install from their phones)

Signing is automatic. Xcode on this Mac is signed in to team 8B8D2GSC9U, and
`xcodebuild -exportArchive -allowProvisioningUpdates` creates what it needs
(App ID, App Store profile, a cloud-managed distribution certificate). A
development build for a cable-connected phone needs that phone registered,
which Xcode does the first time you Run on it.

One-time, by the owner:

1. **App Store Connect → Apps → + → New App**: iOS, name Ember (or any free
   name), bundle id `app.ember.music` (already registered), SKU `ember`.
2. **Users and Access → Integrations → App Store Connect API → +**: role
   **App Manager**. Download `AuthKey_<ID>.p8` (only once) and note the Key ID
   and Issuer ID.
3. GitHub secrets `APP_STORE_CONNECT_API_KEY_ID`,
   `APP_STORE_CONNECT_API_ISSUER_ID`, `APP_STORE_CONNECT_API_KEY`
   (`base64 -i AuthKey_<ID>.p8`), and repo variable `BUILD_IOS=true`.
   Keep the .p8 in a password manager (or `~/.appstoreconnect/private_keys/`
   for local uploads), never in the repo.
4. TestFlight tab: create an **External** group, add testers by email (or
   turn on a public link). The first external build goes through a short
   Beta App Review; internal testers (up to 100 App Store Connect users)
   get it right away.

After that every `v*` tag builds, signs and uploads (the `ios` job in
`native-build.yml`); testers get it in the TestFlight app. Version comes from
`apps/web/package.json`, the build number from the run number. Branch pushes
and manual runs keep the signed .ipa as the `ember-ios-ipa` artifact only.
Without the secrets the job still tests and builds, unsigned, and passes.

Local upload instead of CI, with the key in `~/.appstoreconnect/private_keys`:

```bash
cd apps/mobile/ios/App
xcodebuild -workspace App.xcworkspace -scheme App -configuration Release \
  -destination 'generic/platform=iOS' -archivePath /tmp/Ember.xcarchive \
  CODE_SIGNING_ALLOWED=NO MARKETING_VERSION=<version> CURRENT_PROJECT_VERSION=<build> archive
xcodebuild -exportArchive -archivePath /tmp/Ember.xcarchive -exportPath /tmp/ember-ipa \
  -exportOptionsPlist <plist: method app-store-connect, destination upload, teamID 8B8D2GSC9U> \
  -allowProvisioningUpdates -authenticationKeyPath <.p8> -authenticationKeyID <ID> -authenticationKeyIssuerID <issuer>
```

(or drop the exported .ipa into Apple's Transporter app). Each upload needs a
higher build number than the last.

Ember plays YouTube-sourced audio, so the public App Store is not the goal;
TestFlight builds last 90 days, then a newer one has to be uploaded.

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
would not pass store review. Sideload/direct download only (iPhone: TestFlight,
see above).
