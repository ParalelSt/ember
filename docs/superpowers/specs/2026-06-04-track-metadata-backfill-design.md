# Track metadata backfill — Design

## Problem

Some tracks in the app show no thumbnail and a `--:--` duration. The same track, viewed in search results, always shows both. Affected surfaces: the Home "Recommended" row, the up-next radio in the player, any artist page, plus any row read from PocketBase (Liked Songs, Recently Played, playlists) whose underlying row was first stored from one of those sources.

## Verified root cause

Two stacking bugs, both confirmed by live invocation against `ytmusicapi`.

### Bug 1 — `to_track_json` reads only one of two response shapes

`player.py:to_track_json` reads `t["duration_seconds"]` (int) and `t["thumbnails"]` (plural). Those keys are populated only by `yt.search(filter="songs")`. The other endpoints use a different shape:

| Endpoint | Duration key | Thumbnail key |
|---|---|---|
| `yt.search` | `duration_seconds` (int) | `thumbnails` (array) |
| `yt.get_watch_playlist` (recommended) | `length` (`"3:22"`) | `thumbnail` (array) |
| `yt.get_artist` → `.songs` | `length` (`"3:22"`) | `thumbnails` (array) |

Measured on 2026-06-04:

| Source | Tracks returned | Missing duration | Missing artwork |
|---|---|---|---|
| `search "blinding lights"` | 20 | 0 | 0 |
| `recommended --seed J7p4bzqLvCw` | 50 | 50 | 50 |
| `trending --country US` | 40 | 0 | 0 |
| `artist UClYV6hHlupm_S_ObS1W-DYw` | 5 | 5 | 0 |

`trending` is unaffected because `get_charts` returns nothing useful and `cmd_trending` falls back to `yt.search('top hits')`, which uses the search shape.

### Bug 2 — `upsertTrack` is insert-only

`apps/web/lib/upsertTrack.ts` looks up by `external_id` and, on hit, returns the existing row's id without inspecting it. So once a track has been written from `recommended` or `artist` (via play / like / add-to-playlist), the row keeps `artwork_url = ''` and `duration_sec = 0` forever, even if the same track is later encountered with full metadata from `search`.

## Design — Approach B (parser fix + self-healing upsert)

Two files change. No DB migration, no UI changes, no new endpoints.

### Architecture

```
[ytmusicapi] → player.py:to_track_json ─┐
                                         ├─→ /api/youtube/* routes → Track object
[fallback paths]                        ─┘                                │
                                                                          ▼
                                                          [user clicks: play / like / add]
                                                                          │
                                                                          ▼
                                              POST /api/{history,likes,playlists/[id]/tracks}
                                                                          │
                                                                          ▼
                                                  lib/upsertTrack.ts → PocketBase `tracks`
```

### Component 1 — `player.py:to_track_json`

Generalize the parser to handle both response shapes. Single function, no per-command branches.

```python
def to_track_json(t):
    artists = t.get("artists") or []
    artist = artists[0].get("name") if artists else "Unknown"
    artist_id = artists[0].get("id") if artists else None

    album_obj = t.get("album") or {}
    album = album_obj.get("name") if isinstance(album_obj, dict) else None
    album_id = album_obj.get("id") if isinstance(album_obj, dict) else None

    # search → "thumbnails" (plural). watch_playlist → "thumbnail" (singular).
    thumbs = t.get("thumbnails") or t.get("thumbnail") or []
    artwork = thumbs[-1].get("url") if thumbs else None

    # search → "duration_seconds" (int). watch_playlist / artist → "length" ("3:22").
    duration = t.get("duration_seconds") or parse_length(t.get("length")) or 0

    return {
        "videoId": t.get("videoId"),
        "title": t.get("title"),
        "artist": artist,
        "artistId": artist_id,
        "album": album,
        "albumId": album_id,
        "durationSec": duration,
        "artworkUrl": artwork,
    }


def parse_length(s):
    """'3:22' → 202. '1:02:33' → 3753. Anything else → None."""
    if not s or not isinstance(s, str):
        return None
    parts = s.split(":")
    try:
        nums = [int(p) for p in parts]
    except ValueError:
        return None
    if len(nums) == 2:
        return nums[0] * 60 + nums[1]
    if len(nums) == 3:
        return nums[0] * 3600 + nums[1] * 60 + nums[2]
    return None
```

Additive: search hits `duration_seconds` / `thumbnails` first and short-circuits. The fallbacks only fire when the search keys are absent. Zero risk to the working `search` path.

### Component 2 — `lib/upsertTrack.ts` self-healing

When the existing-row lookup hits, patch in any fields the incoming Track has that the stored row is missing. Patching is **additive only** — never overwrite existing data.

| PB column | "missing" means | Patch source (must be non-empty / > 0) |
|---|---|---|
| `artwork_url` | `''` or `null` | `track.artworkUrl` |
| `duration_sec` | `0` or `null` | `track.durationSec` |
| `album` | `''` or `null` | `track.album` |
| `album_id` | `''` or `null` | `track.albumId` |
| `artist_id` | `''` or `null` | `track.artistId` |

**Deliberately not patched:** `title`, `artist`, `source`, `source_id`, `external_id`, `stream_url`. These are identity-ish or already populated at insert; rewriting them invites display drift (e.g., search returns "Blinding Lights (Original)" while recommended returns "Blinding Lights").

```ts
export async function upsertTrack(pb: PocketBase, track: Track): Promise<string> {
  try {
    const existing = await pb
      .collection('tracks')
      .getFirstListItem(`external_id = "${escape(track.id)}"`);

    const patch = buildBackfillPatch(existing, track);
    if (Object.keys(patch).length > 0) {
      await pb.collection('tracks').update(existing.id, patch).catch((e) => {
        // Backfill is best-effort. A failure here must NOT block the caller's
        // primary action (like / play / add-to-playlist).
        serverLogger.error('api', 'upsertTrack backfill failed', { trackId: existing.id }, e);
      });
    }
    return existing.id;
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
  // …existing insert path unchanged…
}

function buildBackfillPatch(row: RecordModel, incoming: Track): Record<string, unknown> {
  const p: Record<string, unknown> = {};
  if (!row.artwork_url && incoming.artworkUrl) p.artwork_url = incoming.artworkUrl;
  if (!row.duration_sec && incoming.durationSec && incoming.durationSec > 0) p.duration_sec = incoming.durationSec;
  if (!row.album && incoming.album) p.album = incoming.album;
  if (!row.album_id && incoming.albumId) p.album_id = incoming.albumId;
  if (!row.artist_id && incoming.artistId) p.artist_id = incoming.artistId;
  return p;
}
```

**Best-effort rationale:** the caller is hitting `POST /api/likes` to *like* a track. If the backfill `update` errors (PB hiccup, rule misconfig), we still return the row id so the like succeeds. The user's heart-press shouldn't fail because we tried to backfill artwork on the side.

## Verification

Five reproducible checks from the repo root.

### 1. Parser fix — recommended

```bash
./.venv/bin/python player.py recommended --seed J7p4bzqLvCw --limit 5 \
  | python3 -c "import json,sys;d=json.load(sys.stdin); \
    print('missing_duration:', sum(1 for t in d if not t['durationSec'])); \
    print('missing_artwork:', sum(1 for t in d if not t['artworkUrl']))"
```

Pre-fix: `missing_duration: 5, missing_artwork: 5`. Post-fix: both `0`.

### 2. Regression — search

```bash
./.venv/bin/python player.py search "blinding lights" --limit 5 \
  | python3 -c "import json,sys;d=json.load(sys.stdin); \
    print('missing_duration:', sum(1 for t in d if not t['durationSec'])); \
    print('missing_artwork:', sum(1 for t in d if not t['artworkUrl']))"
```

Both must remain `0`.

### 3. Artist — duration now filled

```bash
./.venv/bin/python player.py artist UClYV6hHlupm_S_ObS1W-DYw \
  | python3 -c "import json,sys;d=json.load(sys.stdin)['tracks']; \
    print('missing_duration:', sum(1 for t in d if not t['durationSec']))"
```

Pre-fix: `5`. Post-fix: `0`.

### 4. End-to-end self-healing

In the PB admin UI at `http://127.0.0.1:8090/_/`, open the `tracks` collection and filter `artwork_url = ""`. Pick a dirty row, note its `id`. In the app, like that track (or play it). Refresh the PB admin row: `artwork_url` and `duration_sec` should now be populated.

### 5. Idempotency

Like the same track a second time. The patch object is empty when nothing's missing, so the `if Object.keys(patch).length > 0` guard skips the `update` call — no needless writes.

## Out of scope

- One-time batch backfill of all dirty rows. Self-healing via interaction is enough; rows nobody touches don't need fixing.
- Title / artist drift correction. Identity-ish fields stay frozen at first-insert value to avoid UI flicker between equivalent variants.
- Stream URL refresh. Streams are resolved on demand per playback; the stored `stream_url` is effectively unused for the YouTube source.
