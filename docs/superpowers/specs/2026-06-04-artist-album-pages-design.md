# Artist & Album pages (Spotify-style) — Design

## Goal

Redesign the artist page so it visually echoes Spotify's: a "Popular" tracks section with internal vertical scroll, and a "Discography" horizontal-scroll row of album tiles. Add a new album detail page at `/album/[id]` so the album tiles link somewhere meaningful.

## Scope locked

- **Album tile click target:** opens a full `/album/<browseId>` page.
- **Albums layout on artist page:** horizontal scroll row (matches the existing home rows).
- **Top tracks behavior:** vertical scroll inside a `max-h-96` container, ~6 rows visible, scroll for the rest.

Explicitly *out of scope* this round: liking albums, sharing, an "About" / biography tab, "Fans also like" related-artists row, album-specific radio behavior after queue end.

## Architecture

```
                                                          ┌── /api/youtube/artist/[id]   (existing — no change)
                                                          │
[/artist/[id]/page.tsx]  ──── useQueryArtist()  ──────────┤
   redesigned: hero + scroll-capped top tracks +          │   data already includes albums[]
   horizontal albums row of <AlbumCard>                   │
                                                          │
                                                          │
[/album/[id]/page.tsx]   ──── useQueryAlbum()  ────────── /api/youtube/album/[browseId]  (NEW)
   NEW: playlist-shaped hero + TrackList                                  │
                                                                          │
                                                                  player.py:cmd_album  (NEW)
                                                                  yt.get_album(browseId)
```

No PocketBase changes. No migrations. No zustand stores touched. No PlayerProvider logic changes.

## File map

| File | Change |
|---|---|
| `apps/web/app/(app)/artist/[id]/page.tsx` | Redesign body. Add scroll cap on top tracks; render albums row. |
| `apps/web/components/artist/AlbumCard.tsx` | **NEW.** Square album tile (artwork + title + year), wrapped in a `Link`. |
| `apps/web/components/artist/AlbumRow.tsx` | **NEW.** Horizontal-scroll wrapper, takes `albums[]`. |
| `apps/web/app/(app)/album/[id]/page.tsx` | **NEW.** Hero + TrackList. Shares visual idiom with playlist page. |
| `apps/web/app/api/youtube/album/[browseId]/route.ts` | **NEW.** Mirrors the artist route. |
| `apps/web/lib/sources/youtube.ts` | Add `getAlbum(browseId)`. |
| `apps/web/lib/api.ts` | Add `api.getAlbum(browseId)`. |
| `apps/web/hooks/useLibrary.ts` | Add `useQueryAlbum(browseId)`. |
| `apps/web/proxy.ts` | Add `/api/youtube/album/` to `PUBLIC_API_PREFIXES`. |
| `apps/web/types/track.ts` | Extend `PlaybackContext` union with `{ type: 'album'; albumId: string }`. |
| `player.py` | Add `cmd_album` + `album` argparse subcommand. |

## Component design

### Artist page redesign

Visual structure (top to bottom):

```
┌─ Hero (unchanged) ──────────────────────────────────────┐
│  [round avatar]   ARTIST                                 │
│                   The Weeknd                             │
│                   <description>                          │
└──────────────────────────────────────────────────────────┘

[▶ play button — unchanged]

Popular                                                    ← h2
┌──────────────────────────────────────────────────────────┐
│ 1  [art]  Blinding Lights              After Hours  3:22 │ ┐
│ 2  [art]  Save Your Tears              After Hours  3:35 │ │
│ 3  [art]  Starboy                      Starboy      3:50 │ │ max-h-96
│ 4  [art]  Can't Feel My Face           BBM          3:35 │ │ overflow-y-auto
│ 5  [art]  In Your Eyes                 After Hours  3:57 │ │ (~6 rows visible)
│ 6  [art]  Heartless                    After Hours  3:18 │ ┘
│   ↓ keep scrolling for the rest                          │
└──────────────────────────────────────────────────────────┘

Discography
┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌─────  →
│art │ │art │ │art │ │art │ │art │ │ art    overflow-x-auto
└────┘ └────┘ └────┘ └────┘ └────┘ └─────
After  Starboy Trilogy Beauty Dawn  Idol
Hours  2016    2011    BHTM   FM
2020                   2015   2022
```

**Top-tracks scroll behavior:**
- Wrap `<TrackList>` in `<div className="max-h-96 overflow-y-auto rounded-md">`. `max-h-96` = 24rem ≈ 384px ≈ 6 rows at ~60px each.
- Native scrollbar. Same idiom on mobile (touch-scroll). No special mobile case.

**Albums row:**
- `<AlbumRow albums={data.albums} />` — flex with `overflow-x-auto`, `gap-4`.
- Each `<AlbumCard album={a} />` is a `<Link href={\`/album/${a.browseId}\`}>` containing:
  - Square 160px × 160px artwork (using `a.thumbnails[a.thumbnails.length - 1]?.url`).
  - Truncated title.
  - Year (muted, smaller).
- Hover: subtle `bg-card` + soft shadow. Same idiom as `TrackCard.tsx`.
- **Empty state:** if `data.albums.length === 0`, the "Discography" heading + section omit entirely.

### Album page (new)

Visual structure:

```
┌──────────────────────────────────────────────────────────┐
│  [320px cover]   ALBUM                                   │
│                  After Hours                             │
│                  The Weeknd · 2020 · 14 tracks · 56:13   │
└──────────────────────────────────────────────────────────┘

[▶ play whole album]

1  Alone Again                                         4:10
2  Too Late                                            3:59
3  Hardest to Love                                     3:30
...                                                    ← TrackList showAlbum={false}
```

Notes:
- `showAlbum={false}` on `TrackList` (every row is from this album).
- Total-duration helper `fmtTotal(sec)` formats as `"56:13"` for < 1h, `"1h 3m"` for ≥ 1h.
- No scroll cap. An album is typically 10–20 tracks; the whole page scrolls naturally.
- No "like album" button — not in scope.
- Error state: borrows the artist page's "not found" pattern inline (no new component).

Data shape returned by `/api/youtube/album/[browseId]`:

```ts
{
  title: string;
  artist: string;
  artistId: string | null;
  year: number | null;
  thumbnails: { url: string; width?: number; height?: number }[];
  trackCount: number;
  totalDurationSec: number;
  tracks: Track[];
}
```

## Backend

### `player.py:cmd_album`

`ytmusicapi.YTMusic.get_album(browseId)` returns:

```python
{
  "title": "After Hours",
  "type": "Album",
  "thumbnails": [...],
  "year": "2020",
  "artists": [{"name": "The Weeknd", "id": "UClYV6hHlupm_S_ObS1W-DYw"}],
  "trackCount": 14,
  "duration": "56 minutes, 13 seconds",
  "duration_seconds": 3373,
  "audioPlaylistId": "OLAK5uy_...",
  "tracks": [
    {"videoId": "...", "title": "Alone Again", "artists": [...],
     "thumbnails": [...], "length": "4:10", "duration_seconds": 250,
     "trackNumber": 1, ...},
    ...
  ],
}
```

Implementation:

```python
def cmd_album(args):
    """Resolve an album browseId to title/artist/year/cover + tracks.
    Used by the album page to render a Spotify-style album view."""
    try:
        info = yt.get_album(browseId=args.browse_id)
    except Exception as e:
        print(f"album failed: {e}", file=sys.stderr)
        json.dump({"error": str(e)}, sys.stdout)
        return

    artists = info.get("artists") or []
    primary = artists[0] if artists else {}
    tracks_raw = info.get("tracks") or []
    tracks = [to_track_json(t) for t in tracks_raw if t.get("videoId")]

    out = {
        "title": info.get("title"),
        "artist": primary.get("name"),
        "artistId": primary.get("id"),
        "year": int(info.get("year")) if str(info.get("year") or "").isdigit() else None,
        "thumbnails": info.get("thumbnails") or [],
        "trackCount": info.get("trackCount") or len(tracks),
        "totalDurationSec": info.get("duration_seconds") or sum((t.get("durationSec") or 0) for t in tracks),
        "tracks": tracks,
    }
    json.dump(out, sys.stdout)
```

Argparse:
```python
p_album = sub.add_parser("album", help="Album detail by browseId. Prints JSON.")
p_album.add_argument("browse_id")
# ... in dispatch:
elif args.cmd == "album": cmd_album(args)
```

**Known edge case:** album tracks from `get_album` often lack track-level thumbnails (album cover stands in). `to_track_json` sets `artworkUrl=None`. `TrackList` already conditionally renders the `<img>`, so empty thumbnails collapse — no special handling needed.

### `lib/sources/youtube.ts:getAlbum`

```ts
const ALBUM_ID_RE = /^[A-Za-z0-9_-]{8,40}$/;

interface RawAlbum {
  title?: string;
  artist?: string;
  artistId?: string | null;
  year?: number | null;
  thumbnails?: { url: string; width?: number; height?: number }[];
  trackCount?: number;
  totalDurationSec?: number;
  tracks?: RawYoutubeTrack[];
  error?: string;
}

export async function getAlbum(browseId: string) {
  if (!ALBUM_ID_RE.test(browseId)) {
    const e: PythonError = new Error('invalid albumId');
    e.status = 400;
    throw e;
  }
  const result = await runPython<RawAlbum>(['album', browseId], { timeoutMs: 30000 });
  if (result?.error) {
    const e: PythonError = new Error(result.error);
    e.status = 502;
    throw e;
  }
  return {
    title: result?.title ?? 'Album',
    artist: result?.artist ?? 'Unknown',
    artistId: result?.artistId ?? null,
    year: result?.year ?? null,
    thumbnails: result?.thumbnails ?? [],
    trackCount: result?.trackCount ?? 0,
    totalDurationSec: result?.totalDurationSec ?? 0,
    tracks: (result?.tracks ?? []).filter((t) => t.videoId).map(normalize),
  };
}
```

### `/api/youtube/album/[browseId]/route.ts`

Mirrors the artist route:

```ts
import type { NextRequest } from 'next/server';
import { getAlbum } from '@/lib/sources/youtube';
import { fromError } from '@/lib/upsertTrack';

export async function GET(_req: NextRequest, ctx: RouteContext<'/api/youtube/album/[browseId]'>) {
  try {
    const { browseId } = await ctx.params;
    const album = await getAlbum(browseId);
    return Response.json(album);
  } catch (e) {
    return fromError(e);
  }
}
```

### Client helpers

```ts
// lib/api.ts
getAlbum: (browseId: string) => req<AlbumDetail>(`/youtube/album/${encodeURIComponent(browseId)}`),

// hooks/useLibrary.ts
export function useQueryAlbum(browseId: string | null | undefined) {
  return useQuery({
    queryKey: ['album', browseId],
    enabled: !!browseId,
    queryFn: () => api.getAlbum(browseId!),
    staleTime: 60 * 60 * 1000,
  });
}
```

### `proxy.ts`

Add `/api/youtube/album/` to `PUBLIC_API_PREFIXES`.

### `types/track.ts`

Extend the existing `PlaybackContext` union:

```ts
export type PlaybackContext =
  | { type: 'artist'; artistName: string; artistId: string }
  | { type: 'playlist'; playlistId: string }
  | { type: 'album'; albumId: string }   // NEW
  | { type: 'home' };
```

PlayerProvider's queue-end "radio" logic falls through to the generic case for unknown contexts; no logic change needed.

## Verification

### 1. Python `cmd_album` smoke test

```bash
./.venv/bin/python player.py album MPREb_TH6Wut5eTMQ \
  | python3 -c "import json,sys;d=json.load(sys.stdin); \
    print('title:', d.get('title')); print('artist:', d.get('artist')); \
    print('year:', d.get('year')); print('trackCount:', d.get('trackCount')); \
    print('total_sec:', d.get('totalDurationSec')); \
    print('tracks:', len(d.get('tracks',[]))); \
    print('missing_duration:', sum(1 for t in d.get('tracks',[]) if not t['durationSec']))"
```

Expect: title `"After Hours"`, artist `"The Weeknd"`, year `2020`, trackCount `14`, total_sec ≈ `3373`, tracks `14`, missing_duration `0`.

### 2. API route smoke test (Next must be running)

```bash
curl -s http://127.0.0.1:3000/api/youtube/album/MPREb_TH6Wut5eTMQ | jq '.title, .artist, (.tracks | length)'
```

Expect the same three values.

### 3. Artist page (manual)

- Navigate to any artist via clicking an artist link in a TrackList row.
- Verify: hero unchanged; "Popular" section shows top tracks; vertical scroll appears only if > 6 rows; "Discography" row shows album tiles with horizontal scroll.

### 4. Album navigation (manual)

- Click any album tile in the Discography row.
- Verify: URL goes to `/album/<browseId>`; hero renders with cover, title, artist link, year, track count, total duration; track list loads.

### 5. Album playback (manual)

- Press the big play button on the album page.
- Verify: first track starts; queue is the full album in order; up-next radio (after queue end) falls through to the generic recommended seed — no crash on the new `'album'` context.

### 6. Empty / error states (manual)

- Navigate to `/album/<bogusId>`. Expect "Album not found · Home" panel, no crash.
- Artist with no albums (yt.get_artist returning empty `albums`). Expect the "Discography" heading + section to omit entirely.

## Out of scope

- Liking albums / saving to library.
- Sharing.
- "About" / biography tab on the artist page.
- "Fans also like" related-artists row.
- Album-specific radio behavior after queue end.
- Cross-checking discography sort order (we trust ytmusicapi's order).
