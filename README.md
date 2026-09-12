# Ember

A Spotify-style music streaming app you host yourself. One person runs the
server; friends connect from a browser, the desktop app, or the Android app
over a Tailscale Funnel URL. Dark + ember-red theme.

- **Web app + API:** Next.js 16 (App Router, React 19, Tailwind 4, shadcn/ui)
- **Data + auth:** PocketBase (single Go binary: invite-only accounts, SQLite, REST)
- **Audio source:** YouTube through a bundled Python bridge (`player.py`: yt-dlp + ytmusicapi), cached to disk after first play; members can also upload their own files
- **Desktop app:** Tauri 2 shell with a native Rust audio engine (`apps/desktop`)
- **Android app:** Capacitor shell with native background audio (`apps/mobile`)

Setup and hosting: **[SETUP.md](SETUP.md)**. Native builds, signing, Discord id: **[APPS.md](APPS.md)**. Ports: **[PORTS.md](PORTS.md)**. Tests: **[tests/README.md](tests/README.md)**.

## What it does

- **Search and play** anything on YouTube Music; trending, artist and album pages; a home page built from what you played.
- **Radio**: when the queue runs out it pulls "watch next" recommendations, drops variants of what you already heard, and re-ranks by your own play history.
- **Library**: likes, history, playlists with cover art, recent searches synced across devices, shuffle, loop modes.
- **Playlist import** from Spotify and YouTube Music links.
- **Custom uploads**: members add their own audio files; everyone on the server can play them.
- **Lyrics**: synced lyrics from LRCLib with look-ahead highlighting, plain lyrics from Genius as fallback.
- **Guitar tabs**: a tab generated from the recording itself (Basic Pitch, optional Demucs guitar stem), your own Guitar Pro / MusicXML files rendered by AlphaTab with the cursor following the song, and Songsterr links for everything else. Transport controls and a sync nudge live inside the viewer.
- **Live sessions ("carlist")**: a shared queue several people add to, in sync.
- **Friends listening**: see what other members played recently.
- **Discord Rich Presence**: "Listening to Ember" with a time bar that follows the playhead, from the desktop app on your own Discord; web and phone go through the host's.
- **Privacy switches**: hide what you're playing from Discord and from the friends tab, independently. Both off by default.
- **Bug reports** from inside the app: one click sends the last minutes of client and server logs to the owner's Discord, with an AI summary of the likely cause when an Anthropic key is configured.
- **Desktop auto-update** from the host's own update feed; Windows, Linux and macOS builds from CI.
- **Admin**: users, invites, tracks, logs, and automatic cleanup of songs nobody played.

## Layout

```
spotify-clone/
  apps/
    web/                          # Next.js 16 app — the whole UI + API routes
      app/                        # routes (App Router)
        (app)/                    # authed shell: home, search, library,
                                  #   artist, album, playlist, settings, admin
        api/                      # route handlers — playlists, likes, history,
                                  #   admin/*, auth/check-email, profile,
                                  #   bug-report, plus the youtube/jamendo proxies
        auth/                     # invite-only sign-in / register flow
      components/
        primitives/               # Artwork, PlayButton, LikeButton (props in, no hooks/stores)
        page/                     # PageTitle, SectionHeader, Eyebrow, EmptyState, CollectionHeader
        player/                   # PlayerProvider, PlayerBar, NowPlaying, QueueSheet,
                                  #   TabsDialog + TabViewer (generated guitar tabs)
        nav/                      # Sidebar, TopBar, MobileNav, Drawer, NavLinks
        track/                    # TrackShelf, TrackRow, TrackList; menus/ (TrackMenu, AddToPlaylistMenu, dialogs, data-aware)
        library/                  # CollectionPage, CollectionCard, CollectionShelf, DownloadButton
        artist/                   # AlbumCard, AlbumRow
        settings/                 # SettingsTabs
        admin/                    # AdminTabs
      hooks/
        useTrackActions.ts        # composes player + likes + auth for one track row/card
        useLikeToggle.ts          # the like toggle shared by the player bar and overlay
        useCollections.ts         # Library page's two shelves from one hook
        useOfflinePin.ts          # pin/unpin a collection for offline
        useCollectionPlayback.ts  # play/shuffle-play a collection
        useCreatePlaylistFlow.ts  # create-playlist dialog state, shared by Sidebar and Drawer
        player/                   # PlayerProvider's own hooks: usePositionPersistence,
                                  #   useRadioExtend, useKeyboardShortcuts, useRemoteCommands,
                                  #   useDiscordPresence
      lib/
        format.ts                 # formatTime, formatTotalDuration, formatBytes, formatCount, formatAgo
        shuffle.ts                # the one Fisher-Yates (injectable rng)
        artwork.ts                # pickThumbnail
        layout.ts                 # SHELF_ROW_COUNT, gridColsClass, visibleCount
        collections.ts            # toSummary, countLabel
        playback/
          queueNav.ts              # next/prev index rules, loop wrap point
          radio.ts                 # rankRadioPool, the radio-extend ranking
          shortcuts.ts             # shortcutFor, the keyboard map
        pocketbase/               # browser + server PB clients (cookie-bound)
        sources/youtube.ts        # spawns player.py (yt-dlp) for streams + search
        sources/jamendo.ts        # Jamendo REST adapter
        songKey.ts                # title+artist normalizer for variant-dedup radio
      stores/usePlayerStore.ts    # zustand store (queue, index, playback context)
      proxy.ts                    # middleware — auth gate + cookie refresh
      next.config.ts              # /pb/* rewrite → local PocketBase
    mobile/                       # Capacitor Android wrapper around the web build
  pocketbase/
    pocketbase                # PB binary (gitignored)
    pb_hooks/                 # collections created on boot (uploads, tabs, sessions…)
    pb_migrations/            # older schema as JS migrations
    pb_data/                  # SQLite + files (gitignored, per host)
  player.py                   # YouTube bridge: search, info, download, lyrics, …
  transcribe.py               # recording → guitar tab (alphaTex) for the tab viewer
  my_music/                   # server-side audio cache; uploads/ and tabs/ beneath it
  tests/                      # runnable checks against a sandbox copy (see tests/README.md)
  start-static.sh             # production launcher (PocketBase + Next behind the Funnel)
  update.sh                   # host update: pull, install, refresh yt-dlp, restart
```

## How playback works

1. The browser only ever talks to `/api/*` and `/pb/*` on the app's own origin. No client-side calls to YouTube.
2. `GET /api/search` and the `youtube/*` routes spawn `player.py`; results become the canonical `Track` shape (`id` = `<source>:<sourceId>`, source `youtube` or `upload`).
3. `GET /api/youtube/stream/<videoId>` downloads the track once with yt-dlp and serves the file from `my_music/` from then on, with Range support so seeking works. If the download fails (stale yt-dlp is the usual reason) it falls back to proxying YouTube live, which the native players tolerate badly: **keep yt-dlp current** (`./update.sh`).
4. The web app plays through a swappable audio backend: a plain `<audio>` element in browsers and on phones, the Rust engine in the desktop app.
5. Plays, likes and playlists go through their `/api/*` routes; PocketBase rules keep members' rows to themselves.

## Hosting in one paragraph

`./start-static.sh` starts PocketBase on `:8090` and a production Next build on `:3000`, exposed through `tailscale funnel` as `https://ember.<tailnet>.ts.net`. Phones open the URL or install the Android app; the desktop app is a thin shell that loads the same URL, so web changes reach it on the next launch. Updating the host is `./update.sh`.

## What is intentionally NOT here

- No paid catalog and no scraping of licensed content: YouTube, members' own files, and open lyrics/tab sources only.
- No offline mode on the web. The native apps carry the audio engine; downloads land in your filesystem.
- No public sign-up: accounts are invite-only.
