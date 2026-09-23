# Prefetch: how the host protects itself from the auto cache

Every client (web, desktop, Android) quietly saves the current song and the
next two so a dropped connection does not stop the music. Those downloads
come from the same stream routes as normal playback, marked with
`?prefetch=1`, so the host can treat them as low priority. The client side of
the contract (when a client asks, how it backs off) is in
`apps/web/lib/autoCache/README.md`.

## The contract

```
GET /api/youtube/stream/<videoId>?prefetch=1
  200/206  cached file (Range works as for a play), Cache-Control: private, no-store
  410      unavailable (unchanged)
  429      over the per-listener prefetch limit; JSON {error}, Retry-After: <s>
  502      the download failed (a prefetch never falls back to proxying)
  503      host busy: a cold id while any download runs;
           JSON {error, cause: 'busy'}, Retry-After: 30
           side effect: the id is queued to warm with no delay, so the retry
           finds it on disk
GET /api/uploads/<id>/stream?prefetch=1
  as a play, plus the same 429 and Cache-Control
GET /api/youtube/stream/<videoId>   (no marker: a real play, unchanged)
  a cold id waits for a free download slot (FIFO), then behaves as before
```

A prefetch takes the download path in every `STREAM_MODE`: proxying
googlevideo is where 403s come from, and it would not leave the song on disk
for the listener's real play.

## The numbers

| Setting | Value | Where |
|---|---|---|
| Global download cap | `MAX_CONCURRENT_DOWNLOADS`, default 2 yt-dlp processes | `apps/web/lib/downloadGate.ts` |
| Prefetch slot rule | a prefetch starts a cold yt-dlp only when no download runs and nobody waits | `downloadGate.tryAcquireIdle` |
| Busy answer | 503, `Retry-After: 30` | `apps/web/lib/prefetch.ts` |
| Per-listener limit | 10 prefetches per 60 s, keyed by the PocketBase-verified user id, else the IP (the last `X-Forwarded-For` entry) | `apps/web/lib/prefetch.ts`, `lib/rateLimit.ts` `callerKey` |
| Wait for a slot | a listener's cold download waits up to 60 s (64 at most in line), then 503 and the stream route falls back to live streaming | `ensureDownloaded` in `lib/sources/youtube.ts` |

Joining a download that is already running never takes a slot, so a
prefetch of the song someone is playing right now just waits for that run.
The background warm queue (`lib/streamCache.ts`) goes through the same gate
as a play.

The gate is also the download lane of the Python helper cap (bughunt S04):
searches and page lookups have their own slots (`PYTHON_MAX_CONCURRENCY`,
default 4) and import batches theirs (`PYTHON_MAX_BULK`, default 2), so a
download is counted once, by this gate, and never holds a search slot.

`withRequestLog` logs a 503 at `warn`, like 502 and 504: a busy host is
expected while clients prefetch, not a bug.

## What it costs the host

Prefetching a song costs exactly the work of playing it later: one yt-dlp run
(once ever, the file stays in `MUSIC_DIR`) and one file send. The waste is a
song prefetched and then skipped, which the clients bound (no prefetch in the
first 15 s of a song, a window of two, one download at a time) and the host
bounds again (idle-only cold downloads, 10 a minute per listener). Worst case
with three listeners skipping constantly: three file sends and at most one
prefetch-started yt-dlp, all behind the cap of two.

## Tests

- `apps/web/lib/downloadGate.test.ts`, `lib/sources/youtube.gate.test.ts`,
  `lib/streamCache.test.ts`
- `apps/web/app/api/youtube/stream/[videoId]/route.prefetch.test.ts`,
  `app/api/uploads/[id]/stream/route.prefetch.test.ts`
- `tests/stream-prefetch.test.mjs` (`npm run test:stream-prefetch`), against a
  real server with the fake yt-dlp; its header says how to start one.

## Where the clients keep the songs

- Browser: the Origin Private File System, `cache/audio/` next to pinned
  downloads (`apps/web/lib/autoCache/opfsAdapter.ts`). Never Cache Storage:
  `RegisterSW` empties Cache Storage on every start, so audio there would be
  gone on the next visit.
- Desktop and Android: their own cache directories (Tasks 7 and 6).

The client contract (which songs, when, one at a time, backoff) is in
`apps/web/lib/autoCache/README.md`.
