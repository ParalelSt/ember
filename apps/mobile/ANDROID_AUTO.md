# Android Auto

Ember shows up on the car screen like Spotify does: browse Playlists, Liked
songs, Recently played and Uploads; search (typed, or "Hey Google, play … on
Ember"); play, pause, skip, seek; shuffle and repeat; title, artist, artwork.
It keeps playing with the phone's screen off and after Android has thrown
the app's UI away.

## What Android Auto actually gives you

**You don't design the car UI.** Android Auto renders every media app with the
same Google-supplied template. What an app supplies is content and capabilities:

| Car UI element | What Ember provides |
|---|---|
| Browse tabs and lists | the `MediaLibraryService` browse tree in `EmberPlaybackService` |
| Search + "Hey Google, play X on Ember" | `onSearch` → `/api/search` |
| Play / pause / skip / seek | the Media3 session |
| Shuffle / repeat buttons | custom session commands `ember.shuffle` / `ember.repeat` |
| Track title, artist, artwork | session metadata from the track JSON |

## What's built (`android/app/src/main/java/app/ember/music/`)

- **`EmberPlaybackService`**: a Media3 `MediaLibraryService` with one ExoPlayer.
  It owns playback and the queue on Android; the WebView is a client. Media3
  supplies the notification, lock-screen and Bluetooth controls, audio focus
  and the foreground-service lifecycle.
- **`EmberPlayerPlugin`** (Capacitor plugin `EmberPlayer`): the web UI's handle
  on the player. Commands in (`setQueue`, `play`, `pause`, `seek`, `next`,
  `prev`, `setVolume`, `getState`), events out (`state` at 4 Hz while playing,
  `queue` when the native side changed it, `ended`, `error`). The web side is
  `apps/web/lib/playback/androidBackend.ts`; the provider hands the whole queue
  over and mirrors what native reports.
- **`BrowseTree`**: root → `playlists`, `liked`, `recent`, `uploads`; a playlist
  folder is `playlist:<id>`; tracks use their Ember id. Each list is fetched
  from the same API the web app uses. It remembers every track it has shown,
  because a tap from the car arrives as `playFromMediaId` with only the id, and
  the list that track came from, so a tap plays the rest of that list.
  Searches are cached per query and skipped under three characters (the head
  unit searches per keystroke; the server allows 40 searches a minute).
- **`ServerApi`**: OkHttp against the baked server URL, sending the WebView's
  `pb_auth` cookie on every request and every stream, with one retry on 401
  after re-reading the cookie. **`TrackItems`**: track JSON ↔ `MediaItem`; the
  JSON rides in the item's extras.
- **History**: the service posts `/api/history` on every item start, so plays
  from the car count; the web app skips its own history call on Android.
- **Radio**: when the last queued YouTube track starts, up to 20
  recommendations seeded by it are appended, so the car never falls silent.
- **Manifest**: the service with `mediaPlayback` foreground type and the
  `MediaLibraryService` + `MediaBrowserService` intent filters,
  `res/xml/automotive_app_desc.xml`, the `com.google.android.gms.car.application`
  meta-data.

Known limits: no like button in the car, live sessions (carlist) are not
driven from the car, no offline playback. Playback resumption from the system
media panel is not implemented (Android's "No root for client
com.android.systemui" log line is that probe; harmless).

## Calls and audio focus

A phone call pauses the music and hanging up starts it again, from the same
spot, with no tap from the driver. None of that is Ember's own code: the
player is built with `setAudioAttributes(..., handleAudioFocus = true)`, so
Media3 requests audio focus, the ringtone and the call take it away
transiently, Media3 suppresses playback while that lasts and un-suppresses
when focus comes back. A permanent loss (another media app starts) pauses
Ember for good, which is what it should do: it waits for the driver.

The web UI follows because suppression makes `isPlaying` false, so
`EmberPlayerPlugin` reports `playing = false` in its `state` event and the
play/pause button flips. Measured lag on the emulator is under 50 ms in both
directions. Nothing here needs an `AudioManager.OnAudioFocusChangeListener` of
our own, and adding one would fight Media3 for the same focus.

Run it: get the emulator playing a track at least a minute long (steps in the
header of `tests/android-auto-call.sh`), then `npm run test:android-call`. It
rings, answers and hangs up through `adb emu gsm`, polling `dumpsys
media_session` after each step, and also checks that playback resumed where it
stopped instead of restarting the song. Flipping that `handleAudioFocus` flag
to `false` makes it fail on the ring and on the call, which is how the test was
verified.

## Testing

**Unit tests** (Robolectric): `cd android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew testDebugUnitTest`.

**Phone emulator** (`ember_test`): reaches the Mac's sandbox at
`http://10.0.2.2:3010`, so `npm run apk -- http://10.0.2.2:3010`, `adb install -r`,
sign in, play, press Home: `adb shell dumpsys media_session` shows the session
PLAYING with the position advancing.

**Android Automotive emulator** (`ember_car`, image
`system-images;android-33;android-automotive;arm64-v8a`): the car's Media app
uses the same service contract as Android Auto, so browse, search, tap-to-play,
shuffle/repeat and radio can all be checked without a car. Open it with
`adb shell am start -n com.android.car.media/.MediaDispatcherActivity --es android.car.intent.extra.MEDIA_COMPONENT app.ember.music/app.ember.music.EmberPlaybackService`.
**One difference:** Automotive OS hides apps that have a launcher activity
("Skipping MBS … belonging to non media app" in logcat). Android Auto does
not. For an Automotive check, build a copy with the `LAUNCHER` category
temporarily replaced by `DEFAULT` in `AndroidManifest.xml`, and put it back.

**Desktop Head Unit** (`sdkmanager "extras;google;auto"`, installed): with a
phone on USB, Android Auto app → developer settings → *Start head unit
server*, then `adb forward tcp:5277 tcp:5277` and run
`$ANDROID_HOME/extras/google/auto/desktop-head-unit`.

**Your car**: the only real proof.

⚠️ **A sideloaded Ember will not appear in Android Auto until you enable
developer mode:** Android Auto app → tap the version number ~10 times →
⋮ menu → *Developer settings* → tick **"Unknown sources"**. Without this the
car simply won't list the app, and it looks like the build is broken.
