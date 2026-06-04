# Ember

A Spotify-like music streaming app. Dark + ember-red theme. Self-hosted from your PC; reachable from any phone.

- **Frontend:** Next.js 16 (App Router, React 19, Tailwind 4, shadcn/ui)
- **Backend:** PocketBase (single Go binary — auth, SQLite DB, REST API)
- **Catalog sources:** YouTube (via a bundled Python `yt-dlp` player) + Jamendo (free, CC-licensed)
- **Mobile shell:** Capacitor (Android wrapper around the same web build)

For step-by-step install + hosting instructions see **[SETUP.md](SETUP.md)**.

## Layout

```
spotify-clone/
  apps/
    web/                          # Next.js 16 app — the whole UI + API routes
      app/                        # routes (App Router)
        (app)/                    # authed shell: home, search, library, etc.
        api/                      # route handlers — playlists, likes, history,
                                  # plus the youtube/jamendo proxies
        auth/                     # sign-in / sign-up page
      components/
        player/                   # PlayerProvider, PlayerBar, NowPlaying (mobile full-screen)
        nav/                      # Sidebar, TopBar, MobileNav, Drawer
        track/                    # TrackCard, TrackList, AddToPlaylistMenu
      lib/
        pocketbase/               # browser + server PB clients (cookie-bound)
        sources/youtube.ts        # spawns player.py (yt-dlp) for streams + search
        sources/jamendo.ts        # Jamendo REST adapter
        songKey.ts                # title+artist normalizer for variant-dedup radio
      stores/usePlayerStore.ts    # zustand store (queue, index, playback context)
      proxy.ts                    # middleware — auth gate + cookie refresh
      next.config.ts              # /pb/* rewrite → local PocketBase
    mobile/                       # Capacitor Android wrapper around the web build
  pocketbase/
    pocketbase                    # PB binary (gitignored, per-platform)
    pb_migrations/                # collection schema as JS migrations (committed)
    pb_data/                      # SQLite DB + uploads (gitignored, per-host)
    cloudflared                   # tunnel binary (gitignored)
  player.py                       # yt-dlp wrapper invoked by lib/sources/youtube.ts
  .venv/                          # Python venv for yt-dlp + imageio-ffmpeg
  start.sh                        # one-command launcher with ephemeral tunnel (testing)
  start-static.sh                 # production launcher behind Tailscale Funnel (hosting)
  SETUP.md                        # full setup + hosting docs
```

## How playback works

1. Browser calls `GET /api/search?q=…` or `/api/youtube/search`. Next runs the route handler — there are no client-side calls to external music APIs.
2. The route handler spawns `player.py` (which wraps `yt-dlp`) for YouTube, or hits Jamendo's REST API for Jamendo. Results are normalized into the canonical `Track` shape.
3. The web app's `PlayerProvider` sets `audio.src = track.streamUrl` and plays.
4. On play, the route `POST /api/history` records it; likes and playlists call their respective `/api/...` handlers.
5. PocketBase enforces per-collection rules (the equivalent of Supabase RLS) so users only see their own rows.

The browser talks to PocketBase exclusively through the same-origin `/pb/*` proxy ([next.config.ts](apps/web/next.config.ts) rewrites it to local PB), so the whole app lives on a single public URL and one tunnel covers everything.

## Track shape

```ts
{
  id: string,            // "<source>_<sourceId>", e.g. "yt_dQw4w9WgXcQ"
  source: 'youtube' | 'jamendo',
  sourceId: string,
  title: string,
  artist: string,
  artistId: string | null,
  album: string | null,
  albumId: string | null,
  durationSec: number,
  artworkUrl: string | null,
  streamUrl: string,
}
```

PocketBase persists this on the `tracks` collection keyed by `external_id`, with a unique index — see [pocketbase/pb_migrations/](pocketbase/pb_migrations/). Cached track upserts run through [lib/upsertTrack.ts](apps/web/lib/upsertTrack.ts) before every like / play / playlist insert.

## Radio (auto-queue)

When the queue runs out, the player pulls YouTube "watch-next" recommendations seeded by the last track, then:

- **Filter** — strips out variants of anything currently playing or already queued, using a normalized title+artist match (`(Official Video)` / `(Live)` / `(Remix)` etc. collapse to the same key). See [lib/songKey.ts](apps/web/lib/songKey.ts).
- **Boost** — re-ranks surviving candidates so songs you've already played (from your `plays` history) sit ahead of fresh ones, with a 2-track front-load and "1 favorite every 3 tracks" weave.
- **Context drift** — if you started playback from an artist page, the radio filters out *more by that artist* once the catalog ends, drifting toward similar-genre tracks by other artists.

## Hosting

- **Local dev / quick share:** `./start.sh` boots PocketBase + Next + a Cloudflare quick tunnel and prints a public URL (URL changes per run).
- **Persistent public URL:** `./start-static.sh` runs a production build behind a **Tailscale Funnel** so you get a static `https://ember.<tailnet>.ts.net` — free, no domain needed. Full steps in [SETUP.md](SETUP.md).

Phones never install anything — they just open the URL. Your Mac (or any computer running the stack) only needs to stay on + signed into Tailscale.

## What is intentionally NOT here

- No client-side calls to external music APIs. The browser only ever talks to `/api/*` and `/pb/*`.
- No paid music catalog. YouTube + Jamendo only — works for personal use.
- No download/offline feature. Streaming only.

## Roadmap

- Drag-to-reorder playlists.
- Queue UI (see what's coming up + rearrange).
- iOS Capacitor build (Android already in `apps/mobile/`).
- Crossfade + gapless playback tuning.
