# Ember

A Spotify-like music streaming app. Dark + red theme. Web first; React Native client can be added later against the same API.

- **Frontend (web):** React + Vite
- **Backend:** Node + Express
- **Database / auth:** Supabase (Postgres + Auth)
- **Catalog source:** Jamendo (free, CC-licensed full tracks via official API)

## Layout

```
spotify-clone/
  apps/
    api/                     # Express API
      src/
        index.js             # server entry
        sources/jamendo.js   # music catalog adapter (the only file that talks to Jamendo)
        supabase.js          # Supabase clients (admin + per-request)
        middleware/auth.js   # Bearer-token auth using Supabase
        routes/
          search.js          # GET /api/search?q=
          tracks.js          # GET /api/tracks/:id
          playlists.js       # CRUD playlists
          likes.js           # like / unlike / list likes
          history.js         # record + read recently played
    web/                     # React + Vite client
      src/
        api/client.js        # talks to /api (proxied to :4000 in dev)
        api/supabase.js      # browser Supabase client (auth only)
        context/AuthContext.jsx
        context/PlayerContext.jsx   # HTMLAudioElement-backed player
        components/          # Sidebar, PlayerBar, TrackList, TrackCard, Icons
        pages/               # Home, Search, Library, Playlist, Auth
  supabase/
    schema.sql               # run in Supabase SQL editor
```

## Setup

### 1. Supabase

1. Create a project at https://supabase.com.
2. SQL Editor → paste `supabase/schema.sql` → Run.
3. Settings → API: copy `Project URL`, `anon` key, and `service_role` key.

### 2. Jamendo

1. Register at https://devportal.jamendo.com.
2. Create an app, copy the `Client ID`.

### 3. API

```bash
cd apps/api
cp .env.example .env
# fill in JAMENDO_CLIENT_ID, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
npm install
npm run dev
# -> API on http://localhost:4000
```

### 4. Web

```bash
cd apps/web
cp .env.example .env
# fill in VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
npm install
npm run dev
# -> Web on http://localhost:5173 (proxies /api to :4000)
```

Sign up with email + password on first load. Search, like, build playlists, play.

## How playback works

1. Browser calls `GET /api/search?q=…` (no key in the browser).
2. API proxies to Jamendo, normalizes results into a `Track` shape, returns them.
3. Frontend `PlayerContext` sets `audio.src = track.streamUrl` and plays.
4. On play, frontend posts the track to `POST /api/history` (auth'd) so it shows in "Recently played."
5. Likes and playlists call the corresponding auth'd routes — Supabase RLS enforces that users only see their own rows.

## Track shape

The API normalizes everything into:

```ts
{
  id: string,            // "<source>:<sourceId>", e.g. "jamendo:12345"
  source: string,        // "jamendo"
  sourceId: string,
  title: string,
  artist: string,
  album: string | null,
  durationSec: number,
  artworkUrl: string,
  streamUrl: string,
}
```

If you ever onboard a second legitimate catalog (your own uploads in Supabase Storage, Audius, a licensed distributor, etc.), add a sibling file in `apps/api/src/sources/` and route by the `source` prefix in the track ID.

## What is intentionally NOT here

- No client-side calls to external music APIs. The browser only ever talks to `/api/*`.
- No environment-variable secrets in the web app. `VITE_*` vars are public by design — only the Supabase URL and anon key live there.
- No download/offline feature. Streaming only.

## Roadmap

- React Native client (reuse the API verbatim; replace `<audio>` with `expo-av`).
- Supabase Storage uploads so users can add their own music.
- Drag-to-reorder playlists.
- Queue UI.
- Server-side rendering / static export for marketing pages.
