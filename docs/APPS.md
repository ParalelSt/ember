# Ember native apps: build, sign, install

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
- **Desktop**: .dmg (macOS), .msi/.exe (Windows), .AppImage/.deb (Linux),
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
ever set the host's, Discord needs a local client, which browsers can't reach).

It needs the Discord application id baked in at build time:

```bash
cd apps/desktop
DISCORD_APP_ID=your-app-id EMBER_APP_URL="https://ember.tailf4de41.ts.net" npm run build
```

In CI, add a repo variable `DISCORD_APP_ID`, the workflow already passes it
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
works from a normal Terminal, not from CI or an agent shell. The `.app` builds
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

Lock screen UI test (`AppUITests`, its own scheme so the `App` scheme and CI
stay server-free). It drives SpringBoard for real: locks the simulator,
presses the lock screen's play, pause, previous and next, drags its
scrubber, lets a song end with the screen off, then unlocks and checks
Ember's own player. Needs a sandbox server (never the live one) seeded by
`tests/ios-lockscreen-seed.mjs`; a Debug build loads the server from
`EMBER_TEST_SERVER_URL` instead of `capacitor.config.json`:

```bash
PB_ADMIN_PASSWORD=<sandbox superuser> APP_URL=http://127.0.0.1:3190 PB_URL=http://127.0.0.1:8218 \
  node tests/ios-lockscreen-seed.mjs
cd apps/mobile/ios/App
TEST_RUNNER_EMBER_TEST_SERVER_URL=http://127.0.0.1:3190 TEST_RUNNER_EMBER_TEST_SHOTS=/tmp/lock-shots \
xcodebuild -workspace App.xcworkspace -scheme AppUITests -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 17' -test-timeouts-enabled YES test
```

About 80 seconds. Without `EMBER_TEST_SERVER_URL` the lock screen test
skips. The simulator's Control Center has no media module and its lock
screen draws neither the artwork nor the button glyphs (they are there to
VoiceOver and to taps): artwork and Control Center are for a real phone.

**What the iPhone app is.** No native player: songs play through the page's
web audio backend inside WKWebView (`capacitorBackend`, with no plugin on
iOS). What the shell adds:

- **Background audio / lock screen.** `UIBackgroundModes=audio` plus the
  `playback` audio session category, set at launch (`AudioSession.swift`), so
  music keeps going with the screen locked or the app in the background and
  the silent switch does not mute it. The lock screen and Control Center
  show title, artist, artwork and play/pause/next/previous/seek from
  `navigator.mediaSession`, which WKWebView publishes itself. WebKit only
  passes the page's action handlers on while the element is playing, so
  `webBackend` sets them again on every `playing` (before that the lock
  screen had skip 15 s buttons instead of previous/next), and it drops a
  lock-screen seek that arrives while the next song loads (a scrub to the
  end used to skip the following song too). Checked on the iOS 26
  simulator by the lock screen UI test below.
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

### Notarization: the missing half

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
(all optional, without them the build still succeeds, just unsigned):
`APPLE_CERTIFICATE` (base64 of an exported .p12), `APPLE_CERTIFICATE_PASSWORD`,
`APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`.

## Signing key (Android): IMPORTANT

`apps/mobile/android/ember-release.keystore` + `keystore.properties` live ONLY
on the dev Mac (gitignored). **Back the keystore up**, Android updates must be
signed with the same key, or users must uninstall/reinstall. Regenerate (new
identity) with:

```bash
cd apps/mobile/android
keytool -genkeypair -keystore ember-release.keystore -alias ember \
  -keyalg RSA -keysize 2048 -validity 10000
cp keystore.properties.example keystore.properties   # fill in the password
```

## In-app updates (Android)

The Android app updates itself from the Ember server, like the desktop app
(`AppUpdater.kt`, `UpdateRules.kt`, `UpdateInstaller.kt`, `UpdateCheckJob.kt`
in `apps/mobile/android/app/src/main/java/app/ember/music/`).

**How it works**

1. **Check.** On app start (at most every 15 minutes) and every 6 hours with
   the app closed (Android's JobScheduler, needs a network, kept across a
   reboot), the app asks `GET /api/android/update?version=0.4.18&versionCode=23`.
   The server reads the latest published GitHub Release (the same cached
   lookup as the desktop feed, `GITHUB_RELEASES_TOKEN` required) and answers
   204 (up to date, or any failure) or `{ version, versionCode, url, size,
   sha256 }`. `url` is `/api/android/apk/<id>`, a proxy that streams only the
   latest release's `Ember-vX.Y.Z-android.apk` with the host's token. Both
   routes are public (a signed-out phone must still update); the APK proxy
   is rate limited.
2. **Download.** Only over a network Android has validated (INTERNET +
   VALIDATED) on Wi-Fi, mobile data or ethernet; offline it skips and tries
   at the next check. The APK goes to the app's private cache.
3. **Verify.** Installed only when the file matches the release's sha256
   (when GitHub reported one), its package is `app.ember.music`, its
   versionCode is higher than the installed one, and it is signed with the
   installed app's certificate (a rotated key passes only through its
   lineage). A refused APK is deleted and not downloaded again until the
   person taps Check for updates.
4. **Install** through a PackageInstaller session, and only when that stops
   nothing:
   - never while Android Auto is projecting or a car is connected to the
     player, not even on a tap; the car's Home shows "Ember update ready"
     with "Installs when you're parked and the music is stopped" (or, where
     Android will ask first, "open Ember on your phone to install");
   - never by itself while music plays (phone or cast); a tap on Install is
     the person's choice;
   - by itself only when Android will not ask, Ember is off screen, and
     nothing has played for 2 minutes; with Ember on screen the page shows
     "Update ready, tap to install" instead of the app vanishing.

**Per Android version**

| Android | First update from inside Ember | Later updates |
| --- | --- | --- |
| 6 to 11 (API 23 to 30) | System confirm dialog (after a tap on Install) | Confirm dialog every time |
| 12 (API 31, 32) | Confirm dialog once: the APK was installed by a browser or file manager, which is its installer of record | Silent (`USER_ACTION_NOT_REQUIRED`, Ember is now the installer of record) |
| 13+ (API 33+) | Same as 12 | Silent, through `UPDATE_PACKAGES_WITHOUT_USER_ACTION` |

"Install unknown apps" must be allowed for Ember (Android 8+). When it is
off, the update pill and Settings offer **Allow installs**, which opens that
switch. If Android still asks for confirmation when a silent install was
expected (it decides, not Ember), the confirm screen opens while Ember is on
screen, or waits for a tap.

**In the page.** Inside the Android app only: a small pill under the top bar
(downloading with its percentage, ready, Allow installs, Updating) and an
**App updates** card at the bottom of Settings with the app version and
**Check for updates** (`lib/appUpdate.ts`, `components/update/`,
`components/settings/AppUpdateCard.tsx`).

**Logs.** Every step is sent to `POST /api/native-log` as `update.*` events
(check, available, skip, download, ready, rejected, deferred, install,
confirm, declined, failed, installed, car), so they show on the admin's
**Car and Android Auto** page with the device and surface.

**For each release**

- The tag is `vX.Y.Z` and equals `versionName` in `build.gradle`; the phone
  compares by that name. **`versionCode` must go up**, or the phone refuses
  the APK as not newer. (The release notes may state `versionCode: N`; the
  feed passes it on, but nothing needs it.)
- The release must be published (not draft or prerelease) and carry
  `Ember-vX.Y.Z-android.apk` (the release job names it so).
- **Keep the release keystore.** Every APK must be signed with the same key
  (alias `ember`), or every installed phone refuses the update
  (`update.rejected SIGNATURE_MISMATCH` in the log) and people have to
  uninstall and reinstall. CI signs with it from the repo secrets
  `ANDROID_KEYSTORE_B64` and `ANDROID_KEYSTORE_PASSWORD`
  (`.github/workflows/native-build.yml`, read by `app/build.gradle`); when
  they are missing the build falls back to the debug key, and that APK can
  never update a release-signed install. Back the keystore up somewhere
  besides the Mac and GitHub.

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

## Audio outputs (the Devices button)

One Devices button (speaker icon) in the desktop player bar and the phone's
full-screen player lists where the music can play, lights the one in use,
and switches it; cast devices are in the same list. It only shows when there
is a choice. Web: `apps/web/lib/outputs` (one provider per platform) and
`components/player/DevicesButton.tsx`.

| Platform | Lists | Switches | Needs |
|---|---|---|---|
| Android app | the phone's outputs from AudioManager (speaker, wired, Bluetooth, USB, HDMI) and cast devices from MediaRouter | pins one on the native player (`ExoPlayer.setPreferredAudioDevice`); "More devices" opens Android's Output Switcher (API 30+, Bluetooth settings below); a TV row starts casting | the APK with `getOutputs` on the EmberPlayer plugin |
| iPhone app | the route in use (AVAudioSession) | "AirPlay or Bluetooth" opens iOS's route picker (AVRoutePickerView, `EmberAudioRoute` plugin) | the iOS build with the plugin |
| Desktop app | the native engine's devices (cpal) plus "System default" | moves the rodio output without stopping the song; remembered in `<app config dir>/audio-output.json`; an unplugged device falls back to the default and the music returns when it is back | `audio_outputs` / `audio_set_output` (`src-tauri/src/output.rs`) |
| Browser | speakers the page may name (`enumerateDevices`) | `HTMLMediaElement.setSinkId` (and `AudioContext.setSinkId` once the equalizer is on); remembered in this browser | Chrome or Edge on a computer; "Show all speakers" asks for the microphone once (Chrome names speakers only then); Firefox's own prompt where it has `selectAudioOutput` |

An older app build lacks the new calls: the picker then shows only what it
could before (casting), and nothing fails. The equalizer, volume leveling
and the loudness boost keep working after a switch on every platform (they
are on the player, not on the device).

## Previous button (every app)

Previous follows what was actually played, not the order of the queue. Each
time a song starts because the player moved on to it (Next, the song ending,
a tap on a song in the queue, a tap on another song of the list already
playing), the song being left goes on a small play-history stack (ids, at
most 100). Previous then:

1. past the first 3 s of a song, starts it over (unchanged);
2. otherwise goes back to the song on top of the stack, wherever it sits in
   the queue (the queue stays as it is; only the current song moves), and
   pops it, so pressing again keeps walking back;
3. with nothing usable on the stack (a fresh queue, a song since removed),
   goes to the song above, as before (loop-all still wraps from the top).

Going back never pushes, so two presses never bounce between the same two
songs. Played in order, the stack is exactly the songs above, so playlists
and albums behave as they always did. Playing a different list starts a fresh
stack. Web and desktop: `lib/playback/queueNav.ts` ("Play history") and
`PlayerProvider`. Android: `PlayHistory.kt` in the player service, reached by
the app's button (`ember.previous`), the notification, the lock screen,
Bluetooth keys and the car alike; the TV keeps its own while casting.

## Installing

**Android (sideload):** send the APK (Discord/Drive/USB) → open it on the
phone → allow "install unknown apps" for the browser/file manager when asked.
Play Protect may warn (unknown developer), "install anyway".

**macOS:** open the .dmg, drag Ember to Applications. First launch:
right-click → Open (unsigned app; once per install). No Apple Developer
account = no notarization, which is fine for friends-and-family.

**Store distribution is intentionally off the table**: YouTube-sourced audio
would not pass store review. Sideload/direct download only (iPhone: TestFlight,
see above).
