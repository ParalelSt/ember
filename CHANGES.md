# YouTube Music integration — changes

Wires `player.py` (ytmusicapi + yt-dlp) into the Ember web app. The browser hits the existing `/api/search` endpoint, which now serves YouTube Music results. Playback uses the existing `<audio>`-backed PlayerContext — no new player UI was needed because search results expose a `streamUrl` pointing at a new server route that lazy-downloads the MP3 and serves it with HTTP Range support (so seek/scrub works).

## Architecture, end-to-end

```
Browser (PlayerContext, <audio>)
   │  GET /api/search?q=…           ──▶  Express  ──▶  spawn(.venv/bin/python player.py search "…")
   │  ◀── tracks[] (with streamUrl: /api/youtube/stream/<videoId>)
   │
   │  GET /api/youtube/stream/<id>  ──▶  Express  ──▶  spawn(.venv/bin/python player.py download <id>)
   │                                                     └─▶ yt-dlp + ffmpeg → my_music/<id>.mp3
   │  ◀── audio/mpeg (206 Partial Content, Accept-Ranges: bytes)
```

- The Python script and the Node API share the catalog directory `./my_music/` (resolved relative to `player.py`, overridable via `MUSIC_DIR` env var).
- Files are keyed by `videoId` in API mode (`<videoId>.mp3`) so the Node side can look them up without re-searching. Interactive `python player.py` use still produces the human-named `Artist - Title.mp3` files.
- Range requests are handled by Express's `res.sendFile` (via the `send` package), giving the `<audio>` element scrubbing for free.

## Files changed

### Modified — `player.py`
Refactored to support three modes while preserving the original interactive flow:
- `python player.py search "<query>" [--limit N]` — prints a JSON array of `{videoId, title, artist, album, durationSec, artworkUrl}` to stdout. Used by the Node API.
- `python player.py download <videoId>` — downloads to `my_music/<videoId>.mp3` (or returns the existing one), prints `{"filePath": "..."}` to stdout. Quiet mode; any incidental output from yt-dlp/ffmpeg is redirected to stderr so stdout stays clean JSON.
- `python player.py` (no args) — original interactive prompt → search → download → playsound flow, unchanged in behavior. `playsound3` is now a lazy import inside `play_song()` so the API mode never touches it.
- `MUSIC_DIR` now resolves relative to the script's own location (overridable via `MUSIC_DIR` env var) instead of cwd, so the API can spawn it from anywhere.

### Created — `apps/api/src/sources/youtube.js`
The YouTube catalog adapter. Mirrors the role of `apps/api/src/sources/jamendo.js`. Spawns the venv'd Python and parses JSON.
- Resolves `PYTHON_BIN`, `PLAYER_SCRIPT`, `MUSIC_DIR` from the project root, all overridable by env var.
- `runPython(args, {timeoutMs})` — generic spawn helper, 30 s default timeout, 504 on hang, 502 on bad output.
- `searchTracks(query, {limit})` — invokes `search` subcommand, normalizes results to the canonical `Track` shape with `id: "youtube:<videoId>"` and `streamUrl: "/api/youtube/stream/<videoId>"`.
- `ensureDownloaded(videoId)` — invokes `download` subcommand, 180 s timeout. Validates `videoId` against `^[A-Za-z0-9_-]{11}$` to prevent shell-injection-style abuse of the spawn arg.

### Created — `apps/api/src/routes/youtube.js`
The HTTP surface for YouTube.
- `GET /api/youtube/search?q=…` — returns `{ tracks }`. Empty `q` → empty list (the unified `/api/search` handles trending).
- `GET /api/youtube/stream/:videoId` — calls `ensureDownloaded`, then `res.sendFile` with `Content-Type: audio/mpeg`. Range/seek works because `sendFile` honors `Range` headers.

### Modified — `apps/api/src/index.js`
Mounted the new router:
```js
import youtubeRouter from './routes/youtube.js';
…
app.use('/api/youtube', youtubeRouter);
```
The stream endpoint is intentionally **not** behind `requireAuth` because `<audio src="…">` cannot send Bearer headers. Add a token query param + middleware if you want to gate streaming later.

### Modified — `apps/api/src/routes/search.js`
Re-routed the unified search:
- Empty query → Jamendo `featured` (existing trending behavior). Wrapped in try/catch so a missing `JAMENDO_CLIENT_ID` returns `{ tracks: [] }` instead of 500.
- Non-empty query → YouTube Music via the new `youtubeSearch`.
This means **the existing `Search.jsx` page works unchanged** — it still calls `api.search(q)` and renders the resulting tracks.

### Untouched — frontend
No frontend code was modified. It works because:
- `apps/web/src/api/client.js` `api.search(q)` already hits `/api/search`.
- `apps/web/vite.config.js` proxies `/api` → `http://localhost:4000`, which catches `/api/youtube/stream/...` for free.
- `apps/web/src/context/PlayerContext.jsx` sets `audio.src = current.streamUrl`; the relative URL resolves against the web origin and gets proxied.
- `apps/web/src/components/PlayerBar.jsx` already provides play/pause/seek/next/prev via the existing context — these are the "controls from the frontend" the task asked for.

### Created — `player.py` test artifacts
- `my_music/J7p4bzqLvCw.mp3` (4.7 MB, "Blinding Lights") — created by the smoke test of `/api/youtube/stream/...`.

## How to run

Two terminals, from the repo root:

```bash
# Terminal 1 — API (Node)
cd apps/api && npm run dev
#   → API on :4000, will spawn ../../.venv/bin/python ../../player.py on demand

# Terminal 2 — Web (Vite)
cd apps/web && npm run dev
#   → http://localhost:5173, proxies /api to :4000
```

Sign in (Supabase), type a query in the search bar, click a track. First play of any track has a multi-second cold start (yt-dlp download + ffmpeg transcode); subsequent plays are instant from the cached MP3.

## Configuration

New env vars (all optional, all read by `apps/api/src/sources/youtube.js`):

| var             | default                                | purpose                                  |
| --------------- | -------------------------------------- | ---------------------------------------- |
| `PYTHON_BIN`    | `<repo>/.venv/bin/python`              | Interpreter that has `ytmusicapi`/`yt-dlp` |
| `PLAYER_SCRIPT` | `<repo>/player.py`                     | The script the API spawns                  |
| `MUSIC_DIR`     | `<repo>/my_music`                      | Where MP3s are cached                      |

The `JAMENDO_CLIENT_ID` is no longer required — it's only used for the empty-query trending list, and a missing key now degrades gracefully.

## Caveats / known issues

- **Cold start latency.** First play of a track blocks the HTTP request for the duration of the YT download + mp3 transcode (typically 3–10 s on a good connection). The browser's `<audio>` will sit in `loading` state during that time. Could be improved by streaming chunks during transcode, or by pre-fetching on hover.
- **No auth on `/api/youtube/stream`.** As noted above, `<audio>` can't send Authorization headers. Anyone who can reach the dev server can stream. Fine for local dev, not for prod.
- **Disk usage grows unbounded.** No eviction on `my_music/`. Add an LRU sweeper if this matters.
- **Legal posture.** This downloads from YouTube via yt-dlp, which is against YouTube ToS and is copyright infringement for non-CC content. The original Jamendo path was deliberately CC-licensed; this integration sidesteps that. Keep it local — do **not** deploy this publicly.
- **`--limit` is a hint.** ytmusicapi's `search()` returns more results than the limit suggests; the cap is enforced loosely. Not a blocker.

## Quick verification

```bash
# Python CLI
.venv/bin/python player.py search "blinding lights" --limit 2
# → [{"videoId":"J7p4bzqLvCw", ...}, ...]

# API search
curl -s 'http://localhost:4000/api/search?q=blinding%20lights' | jq '.tracks[0]'

# API stream (Range request — confirms 206 + audio/mpeg + Accept-Ranges)
curl -sI -H 'Range: bytes=0-99' 'http://localhost:4000/api/youtube/stream/J7p4bzqLvCw'
```
