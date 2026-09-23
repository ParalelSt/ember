# Stream stall on the Windows desktop app, 2026-09-22

An automatic report from the desktop app, kept here because it is the first
one that points at the stream path rather than at the app. Nothing is fixed
yet; this is the record and the list of what to check.

## What happened

Luka (luka29071@gmail.com) played "夜葉：罪と罰の螺旋――。 - YoRHa : Tsumi To
Batsu No Rasen." (`youtube:OuB-iWbGJqw`) in the Windows desktop app. The
native audio engine received nothing for 3 seconds mid-track, gave up, and
the app fell back to web audio and kept playing. The report was sent by the
app itself, not by a person.

- Reported: 2026-09-22 19:29 CEST (17:29 UTC)
- App: tauri 0.3.10 (d022bcd, 2026-09-20) on Windows, Edge WebView 153
- Route `/`, online, queue 2 of 49, loop off, shuffle off, no downloads pinned
- Server errors in the report: **0**
- AI triage: streaming, severity high, confidence medium

## Timeline (client, one session)

```
19:29:18.516  route /
19:29:18.581  backend selected            tauri-native
19:29:18.798  load  youtube:OuB-iWbGJqw   tauri-native, source stream
19:29:27.341  ERROR the song stopped arriving while decoding (nothing for 3s)
19:29:27.346  ERROR native audio failed, falling back to web audio
19:29:27.359  load  youtube:OuB-iWbGJqw   web, source stream
19:29:27.386  play
```

So bytes did start arriving (the decoder ran for about 8.5 s), then the
stream went quiet for 3 s and the engine declared it stalled.

The session before it shows the same track playing fine at 19:26, and four
"seek jump" lines at 19:23 on a different track (`youtube:fLgidPGdi3w`),
where the position snapped backwards. Those are worth a second look on
their own.

## Where this comes from in the code

- `apps/desktop/src-tauri/src/audio.rs`: `STALL_BUDGET` is 3 s of no
  progress while a download is in flight, which is exactly the error text.
  The error carries `retry: "web-audio"`, which is why the app recovered.
- `apps/web/app/api/youtube/stream/[videoId]/route.ts`: with the default
  `STREAM_MODE=cache` the host runs yt-dlp first and then serves the file
  with Range support; in proxy mode it replays signed googlevideo headers.
  `lib/streamGuard.ts` gives the host 6 s for headers and 10 s for a body
  stall, so the client gave up before the server would have.

## Why the host log is empty

The report carries the last few minutes of server logs, and there were none.
`withRequestLog` only records 4xx and 5xx, so a request that kept the socket
open and simply went quiet leaves no trace. That is a gap: a stream that
stalls mid-body is invisible on the host side.

## What to check on the host

1. `logs/errors-2026-09-22.jsonl` around 17:29 UTC for anything on
   `youtube/stream` (expected: nothing, which is the point above).
2. Whether `my_music/OuB-iWbGJqw.*` exists and is complete. A partial file
   from an interrupted yt-dlp run would serve a short body.
3. `STREAM_MODE` on the host. In proxy mode a signed googlevideo URL that
   expires or gets throttled mid-transfer produces exactly this shape.
4. yt-dlp version. The host was still on an old one at the time, which is
   also what causes the 403s on downloads. `./update.sh` upgrades it.
5. The host's own connection during that minute.

## What would make this better

- **Log a stalled stream on the host.** A body that stops mid-flight should
  leave a warn line with the video id and how many bytes went out.
- **Resume instead of falling back.** The engine already knows the byte
  position, and the route already answers Range requests, so a stall could
  retry the same byte offset once before dropping to web audio.
- **The auto-cache plan helps directly** (`docs/superpowers/plans/2026-09-22-auto-cache-offline.md`):
  a track kept on disk after it plays, and the next songs fetched ahead,
  turn a mid-song stall into silence the cache can cover.

## Open, unrelated but visible in the same report

The four backwards "seek jump" lines at 19:23 on `youtube:fLgidPGdi3w`. The
position jumped from about 112 s back to 86 s four times in a minute. That
looks like the old song-skip behaviour rather than anything the user did.
