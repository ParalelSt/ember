# Android Auto — plan and constraints

Goal: Ember appears on the car screen like Spotify does — browse your
playlists, search, play/pause/skip, shuffle and repeat.

## What Android Auto actually gives you

**You don't design the car UI.** Android Auto renders every media app with the
same Google-supplied template. Spotify's car screen *is* that template. What an
app supplies is content and capabilities:

| Car UI element | What the app must provide |
|---|---|
| Browse tabs and lists | A `MediaLibraryService` browse tree |
| Search + "Hey Google, play X on Ember" | `onSearch` on that service |
| Play / pause / skip / seek | A `MediaSession` with transport controls |
| Shuffle / repeat / like buttons | Custom actions on the session |
| Track title, artist, artwork | Session metadata |

## Why the current app can't do it

`apps/mobile` is a thin Capacitor WebView pointing at the live server. Audio is
an HTML5 `<audio>` element inside that WebView, and `@capgo/capacitor-media-session`
wraps it in a `MediaSessionCompat` for lock-screen controls.

Android Auto only lists apps that expose a **`MediaBrowserService`**. The capgo
plugin declares a plain `Service` (see its `AndroidManifest.xml`), so Ember does
not appear on the head unit at all — no amount of configuration changes that.

Two further problems with driving a car from a WebView:

- The WebView belongs to the Activity. Android can destroy the Activity while
  the foreground service lives on, which kills playback mid-drive.
- WebView audio doesn't hold audio focus reliably in car mode, so navigation
  prompts and calls interact badly with it.

**Conclusion: playback has to move into native code.** That is Phase 1 below,
and it improves phone background reliability too.

## What already works without any of this

Bluetooth or USB audio: the car plays Ember, shows title/artist over AVRCP, and
steering-wheel buttons work through the existing MediaSession. No Ember UI on
the head unit, no browsing. That stays true throughout.

## Phases

### Phase 1 — native player + bridge

- Media3 `ExoPlayer` becomes the audio engine on Android.
- A Capacitor plugin bridges the web UI to it: play/pause/seek/queue in,
  state/position events out.
- The web app already abstracts playback backends (`lib/playback/`, built for
  the Tauri desktop app), so this plugs into that seam rather than rewriting the
  player.
- Auth: ExoPlayer needs the `pb_auth` cookie to hit `/api/youtube/stream/...`
  and `/api/uploads/...`. Read it from the WebView's `CookieManager` after
  sign-in and attach it as a header on the data source.

### Phase 2 — the car

- Promote the service to a `MediaLibraryService` with a browse tree:
  **Playlists / Liked / Uploads / Recently played**, each expanding to tracks.
- `onSearch` → the existing `/api/search`, which also makes voice search work.
- Custom actions for shuffle and repeat.
- Manifest: `automotive_app_desc.xml` with `<uses name="media"/>` plus the
  `com.google.android.gms.car.application` meta-data.

No server changes are needed for either phase — `/api/playlists`, `/api/likes`,
`/api/uploads`, `/api/history` and `/api/search` already return what the browse
tree needs.

### Phase 3 — polish

Artwork in the car, radio/autoplay at the end of a queue, like button.

## Testing

- **Emulator (me):** the Android Automotive OS system image runs media apps
  with the same service contract, so browse, search and playback can be
  verified without a car.
- **Desktop Head Unit:** `$ANDROID_HOME/extras/google/auto/desktop-head-unit`
  against a USB-connected phone — closer to the real thing.
- **Your car (you):** the only real proof.

⚠️ **A sideloaded Ember will not appear in Android Auto until you enable
developer mode:** Android Auto app → tap the version number ~10 times →
⋮ menu → *Developer settings* → tick **"Unknown sources"**. Without this the
car simply won't list the app, and it looks like the build is broken.
