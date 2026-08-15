# Ember native apps — build, sign, install

The Android and desktop apps are **thin webview shells around the live server**
(they load `EMBER_APP_URL`; nothing is bundled). Native extras: background
audio + media notification on Android, Rust audio + media keys on desktop.

## Get builds from CI (easiest)

Push a tag like `v0.2.0` (or run the **native-build** workflow manually):
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

## Discord status (desktop app)

The desktop app sets **each user's own** Discord status (the server can only
ever set the host's — Discord needs a local client, which browsers can't reach).

It needs the Discord application id baked in at build time:

```bash
cd apps/desktop
DISCORD_APP_ID=your-app-id EMBER_APP_URL="https://ember.tailf4de41.ts.net" npm run build
```

In CI, add a repo variable `DISCORD_APP_ID` and pass it to the build step.
Without it the feature is silently off (playback is unaffected). Users also
need the Discord desktop app running; if it's closed, Ember reconnects on the
next track change.

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
