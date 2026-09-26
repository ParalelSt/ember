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
- **Mac LAN IP (http, allowed to that host only):** `http://192.168.x.x:3000`

```bash
EMBER_APP_URL="https://ember.<tailnet>.ts.net" npm run sync
```

> Tailscale is the preferred path because the funnel serves **https**. The
> http LAN-IP path also works (cleartext to that one host, see below), but
> https is preferred: plain http can be read and changed on the way.

## Scripts

```
npm run apk -- <url>          # build a sideloadable debug APK for that server
npm run apk -- <url> --install  # …and adb install it onto a plugged-in phone
npm run sync         # cap sync (copies config + plugins into native projects)
npm run sync:ios     # cap sync ios
npm run open:android # open the Android project in Android Studio
npm run run:android  # build & run on a connected device/emulator
npm run open:ios     # open the iOS project in Xcode
```

`npm run apk` is the one-command path to a phone build: it finds a JDK 17+
(Android Studio's bundled one) and the SDK, syncs the URL in, and runs Gradle.
It refuses `localhost` URLs, since a phone can't reach them.

Audio on Android is **native** (Media3/ExoPlayer in `EmberPlaybackService`),
which is what puts Ember in **Android Auto**: browse, search, transport,
shuffle/repeat, radio. The WebView is the phone UI and talks to the player
through the `EmberPlayer` Capacitor plugin. Details, emulator recipes and the
Android Auto "Unknown sources" step: [ANDROID_AUTO.md](ANDROID_AUTO.md).
An emulator build points at the Mac with `npm run apk -- http://10.0.2.2:3010`.

There is **no web build step** — nothing is bundled. `sync` only pushes the
config (incl. `EMBER_APP_URL`) and the fallback `public/` page into the native
projects, so re-run `sync` whenever you change `EMBER_APP_URL`.

## Android cleartext

Cleartext HTTP is **off** for every host, with one exception: when the URL
the APK is built for is `http://` (a LAN or Tailscale IP, or the emulator's
`http://10.0.2.2:3010`), that host, and only that host, may use plain http.
`android/app/network-security.gradle` writes the network security config
from `assets/capacitor.config.json` (what `npx cap sync` bakes in) on every
build, and the manifest points at it. An `https://` server (the Tailscale
Funnel) gets no cleartext exception at all. Mixed content (http resources on
an https page) is refused (`allowMixedContent: false`, and `MainActivity`
sets the WebView to never allow it).

So a phone built for one http server cannot fetch http from anything else;
to point it at another server, rebuild with that URL as usual. Android 6
(API 23) has no per-host config: there, cleartext stays allowed as before.
Tests: `NetworkSecurityTest`.

## Offline (Android only)

Pins, not a bulk cache: each playlist and Liked Songs can be pinned for
offline playback (pin ids: the playlist id, or `liked`). A pin downloads its
tracks' audio (and artwork, best effort) to app-private storage:
`files/offline/index.json`, `files/offline/audio/<safeId>.m4a`,
`files/offline/art/<safeId>.jpg`, refcounted so a track shared by two pins
keeps its file until neither pin lists it. A downloaded track plays from
that local file even while online. The native `EmberOffline` Capacitor
plugin backs this; a foreground `OfflineDownloadService` downloads one track
at a time with one retry before marking it failed. Liked Songs re-syncs its
pin on every like/unlike once it has been pinned once. Stale host `yt-dlp`
breaks downloads per track the same way it breaks streaming: a track fails,
gets retried once, then shows failed in Settings, Downloads with a Retry
button. See SETUP.md's
["Keep yt-dlp and ytmusicapi updated"](../../SETUP.md#keep-yt-dlp-and-ytmusicapi-updated--do-this-when-things-break).

The plugin's `status()` (and the `offline` event it pushes on every change)
returns:

```jsonc
{
  "pins": [{ "id": "", "name": "", "total": 0, "done": 0, "failed": 0,
             "failedReason": null, "downloading": false, "trackIds": [] }],
  "trackFiles": { "<trackId>": "/abs/path.m4a" },  // downloaded audio
  "artFiles":   { "<trackId>": "/abs/path.jpg" },  // downloaded artwork
  "totalBytes": 0,
  "progress": { "id": "", "done": 0, "total": 0, "title": "" } // only while downloading
}
```

Member uploads keep their embedded cover: the server extracts it at upload
time and serves it from the relative `/api/uploads/<id>/art`, which the
downloader resolves against the server URL the same way it resolves a
relative `streamUrl`.

`artFiles` is a subset of `trackFiles`: artwork is best effort, so a track
can have audio and no art. Both are absolute app-private paths, which the
WebView can only load through `Capacitor.convertFileSrc`. `failedReason` is
`auth`, `storage` or `http` (the pin's FIRST permanent failure), or null.

Plugin methods: `status`, `tracks({ id })`, `serverUrl`, `pin({ id, name,
tracks })`, `retry({ id })`, `unpin({ id })`, `cancel({ id })`, `clearAll`.
`retry` re-queues only that pin's failed tracks from the index, so it needs
no track list from JS and cannot re-sync a pin to a stale one; `pin` is the
only method that changes which tracks a pin lists. `retry` rejects an unknown
pin id with "no such pin".

**A signed-out download must fail loudly, never quietly succeed.** The server
answers an unauthenticated stream request with a redirect to `/auth`, so
without the rule in `OfflineDownloader.download` the drain would happily write
the sign-in page to disk as a `.m4a` and report the pin as Downloaded: the
user only finds out when they press play in a tunnel. After `isSuccessful`,
a final URL whose path starts with `/auth`, or a `text/html` body, is
therefore a failure: reason `auth` when it landed on `/auth`, else `http`.
Nothing is written and the track stays pending, so a later retry (once the
session is back) picks it up.

**Local artwork reaches the lock screen as a `data:` URL, not as a file
path.** `Capacitor.convertFileSrc` produces a URL only the WebView can
resolve, but `@capgo/capacitor-media-session` loads artwork natively over
`HttpURLConnection`, so handing it a converted path gives the lock screen no
cover at all (silently: `dumpsys notification` just shows `largeIcon=null`).
Both players therefore re-read the file where it does resolve and follow up
with a `data:` URL: `capacitorBackend.setMetadata` for the in-app player and
`play()` in `offline.html` for the cold-start page. Both guard the follow-up
with the track index they started from, so a slow read for a track the user
has already skipped past cannot leave the lock screen a track behind.

`capacitor.config.ts` sets `server.errorPath: offline.html`, a bundled page
(`public/offline.html`) Capacitor shows whenever the main-frame request to
the server fails, including a reachable server's main-frame 4xx/5xx, not
just being offline. It lists downloaded tracks by pin, plays them locally,
drives the lock screen via the capgo `MediaSession` plugin, and has a "Try
again" button. It needs `window.Capacitor` injected, which Capacitor does
not do for the error page by default; `MainActivity.java` composes and
registers that injection by hand using Capacitor's `JSExport` statics.
**Upgrade-sensitive**: not a documented contract, re-check on Capacitor
bumps (falls back to "Connecting to server..." rather than crashing).

Testing:
```bash
npm run test:offline-ui       # web UI, from apps/web
node tests/offline-page.test.mjs   # bundled offline page, headless
cd apps/mobile/android && ./gradlew testDebugUnitTest   # OfflineStore + downloader
```

The downloader tests (`OfflineDownloadServiceTest`) drive the drain against
MockWebServer. The drain lives in `OfflineDownloader`, not in the service,
precisely so it can be run synchronously from a JVM test;
`OfflineDownloadService` is only the thread and the foreground notification
around it, so put download rules in the former and keep the latter thin.

Emulator recipe: boot the AVD, sign in, pin a playlist while online,
`adb shell cmd connectivity airplane-mode enable`, confirm playback and lock
screen controls still work, force-stop and relaunch to hit the cold-start
page, then `airplane-mode disable` and tap "Try again".

Driving the WebView from a script: Playwright cannot attach, so talk raw CDP
to the DevTools socket.

```bash
adb forward tcp:9333 localabstract:webview_devtools_remote_$(adb shell pidof app.ember.music)
curl -s http://127.0.0.1:9333/json          # find the page target's webSocketDebuggerUrl
```

then `Runtime.evaluate` over a WebSocket (`tests/android-native-log.mjs` is
the pattern). Three things that will otherwise cost an hour:

- **The pid changes on every force-stop**, so re-run the `adb forward` after
  one or the socket name no longer exists.
- **A navigation destroys the execution context**, so `Page.navigate` and
  then reconnect rather than setting `location.href` and evaluating on.
- **Repeated airplane-mode toggling can wedge the emulator's networking**
  (airplane mode reads as off and there is still no `eth0`). `adb reboot`
  restores it, and app data, including downloads and the session, survives.
  Check `adb shell ping -c 1 10.0.2.2` before blaming a page load: with the
  radio off a full reload correctly lands on `offline.html`, which looks like
  a failure but is the feature.

Evidence to collect, since the interesting state is not on screen:
`dumpsys media_session` for the session and its metadata,
`dumpsys notification --noredact | grep largeIcon` for the lock-screen cover
(`Icon(typ=BITMAP ...)` means it loaded, `null` means it did not),
`run-as app.ember.music ls -l files/offline/audio files/offline/art` for what
actually reached disk.

## Auto cache (Android only)

Separate from pins: while a queue plays, the native player keeps the
current song and the next two on the phone, so a dropped connection does
not stop the music at once. It lives in the playback service
(`AutoCacher.kt`, `MediaCache.kt`), so it works with the screen off and in
Android Auto, and runs the same policy as the web and desktop apps
(`AutoCachePolicy.kt`, a port of `apps/web/lib/autoCache/policy.ts`, tested
against the same `policy.cases.json`).

- **Where:** a Media3 `SimpleCache` in `cache/media3-audio`, capped at 300 MB,
  least recently used out first. Every streamed song is written through as it
  plays; `CacheWriter` fetches the next two (`?prefetch=1`, one at a time,
  after 15 s of the current song and once it is buffered). Pinned downloads
  stay in `files/offline` and are never evicted by this.
- **When not:** setting off, offline, battery saver, Data Saver, or mobile
  data unless "Also on mobile data" is on (default off). Busy (503) and
  rate-limited (429) answers back off as the server asks; 410 drops the song.
- **Offline:** songs on the phone (cached whole, or pinned) play; others are
  skipped in play order. With nothing ahead, playback pauses and the state
  says `offlineStalled`. When the phone has a validated network again the
  song is loaded, paused.
- **Web side:** `lib/autoCache/native.ts` (the bridge) and
  `lib/autoCache/androidAdapter.ts` (the cache as Settings and the badge see
  it). No JS download ever runs on this engine: the page hands the two
  settings down whenever they change and mirrors `offline` and
  `offlineStalled` into the Offline badge. Plugin methods on `EmberPlayer`:
  `setAutoCache({ enabled, onMetered })` (kept across restarts),
  `cacheStats()` and `clearCache()` (both `{ bytes, count, cap }`), and the
  `state` event gains `cachedIds`, `offlineStalled` and `offline`. Older app
  builds lack the methods and the wrapper does nothing.
- **Tests:** `./gradlew testDebugUnitTest` runs every shared case
  (`AutoCachePolicy*CaseTest`, read from the web folder, never copied) plus
  `AutoCacherTest`, `MediaCacheTest`, `OfflineSkipTest`,
  `ServiceAutoCacheTest`.

## Voice search (Android)

The mic in the search box uses Android's own `SpeechRecognizer` (the default
recognizer, which Google runs on the device where it can), never the
WebView's `webkitSpeechRecognition` (it exists but every session fails with
`network`). It needs, in `AndroidManifest.xml`:

- `<uses-permission android:name="android.permission.RECORD_AUDIO" />`, asked
  for at the first mic tap. Denied gives the toast "Allow microphone access to
  use voice search."
- a top-level `<queries><intent><action android:name="android.speech.RecognitionService" /></intent></queries>`:
  without it Android 11+ package visibility hides the recognizer and
  `isRecognitionAvailable` is false.

The native `EmberSpeech` Capacitor plugin (registered in `MainActivity.java`,
reached from the web app as `window.Capacitor.Plugins.EmberSpeech`):

| | |
|---|---|
| `available()` | `{ available, onDevice }` |
| `start({ lang })` | starts listening; rejects with `code` = `permission-denied` or `unavailable` when it cannot |
| `stop()` | stop capturing; the final result still arrives |
| `abort()` | drop everything; only `end` follows |
| events | `partial { text }`, `final { text }`, `error { kind, detail? }`, `end {}` |

`kind` is one of `permission-denied`, `unavailable`, `network`, `no-speech`
(silence, no toast), `aborted`. An APK from before voice search has no
`EmberSpeech` plugin, and the mic then says "Update the Ember app to use voice
search."

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

### Stale `capgo-capacitor-media-session` project path

Gradle failing with `No matching variant of project :capgo-capacitor-media-session
… No variants exist` means the plugin's `projectDir` in the generated
`android/capacitor.settings.gradle` points somewhere npm did not install it
(npm may place the package under `apps/mobile/node_modules` or hoist it to the
root, and the checked-in generated path can go stale). Fix: `npm install` at the
repo root, then re-run `cap sync` with the URL you want kept, e.g.
`EMBER_APP_URL="https://ember.<tailnet>.ts.net" npx cap sync android`, which
rewrites the path. Do not hand-edit the generated file.
