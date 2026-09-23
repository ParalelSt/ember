# Stream stall on the Windows desktop app, 2026-09-22

An automatic report from the desktop app, kept here because it is the first
one that points at the stream path rather than at the app. It happened again
on 2026-09-23 (below), and the cause is now found and fixed on the
`stream-stall` branch: see "Root cause" at the end.

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

## Again on 2026-09-23: "Couldn't load"

Two users, the owner among them, got `Couldn't load "Pain Remains II: After
All I've Done, I'll Disappear"` (Lorna Shore, `youtube:EOugbQC1r0s`, 5:37 on
YouTube). The automatic report:

- App: tauri 0.5.0 (ec2344c) on Windows, `[audio]` backend
- `the song stopped arriving while decoding (nothing for 3s)`, twice
- Server errors in the report: **0**
- The same stall on `EOugbQC1r0s`, `TwFXwkKyGSQ` and `fLgidPGdi3w` (the track
  with the seek jumps above)
- Breadcrumbs: load, click, load x2, click, load x2: each click retried the
  song and each retry failed the same way

The difference from the 22nd is only the ending. Since 4dfc600 a stall is
reported with `retry: "none"` (the host "could not deliver"), so the webview
no longer falls back to web audio and says "Couldn't load" instead. On the
22nd the host still ran a web build from before that change, which is why the
same engine error fell back and played.

## Root cause

It was never a stall mid-song. Both reports fail while the decoder is being
BUILT (on the 22nd: load at 18.798, error at 27.341, no play in between), and
the build was doing far more network work than playing needs.

1. **Fragmented bodies were walked fragment by fragment.** The engine builds a
   seekable decoder (65dd76c, so seeks stop ending songs). For an mp4,
   symphonia then reads every top-level atom before the first sample. The
   body YouTube serves (and the stream route proxies, and a host keeps when
   yt-dlp's ffmpeg fixup did not run) is fragmented: a moof/mdat pair per
   ~10 s, each mdat ~160 KB. Every hop over an mdat is a seek past what has
   arrived, and `stream-download` answers each one with a new Range request.
   Measured locally on the real googlevideo bodies (fake host, 300 ms per
   request, 1 MB/s):

   | track | fragments | before | after |
   |---|---|---|---|
   | EOugbQC1r0s (5:37, 5.4 MB) | 34 | 33 requests, 16.0 s to a decoder | 1 request, 0.33 s |
   | TwFXwkKyGSQ (7:21, 7.1 MB) | 45 | 43 requests, 22.1 s | 1 request, 0.33 s |
   | fLgidPGdi3w (3:02, 3.0 MB) | 19 | 10 requests, 6.1 s | 1 request, 0.33 s |

   Each of those requests is a fresh connection through the Tailscale Funnel,
   in series, with the host still pushing out the bodies the client just
   dropped. One of them taking 3 s is the exact error in both reports, and the
   host logs nothing because every response was a fast 200/206: hence 0
   server errors. Longer tracks have more fragments, so they fail more.
   A browser reads the same body linearly from one request, which is why web
   audio played it.

2. **Remuxed (cached) files waited for the whole body.** A plain m4a needs
   one read of its last 64 KB while the decoder is built. `stream-download`
   restarts its 256 KB prefetch after a seek, and the prefetch path never wakes
   the reader waiting on that seek, so the read was answered only when the
   linear download got there: after the entire file. 7.4 s for the cached
   5.4 MB track at 1 MB/s, 0.77 s now. On a slow link a long track hit the
   25 s "still decoding" budget this way.

3. **A stall had no second chance.** Any stall ended the load for good.

Reproduced in `apps/desktop/src-tauri/src/audio/stall_repro.rs`: with the old
load path, `slow_round_trips_do_not_fail_a_fragmented_load` fails with
"the song stopped arriving while decoding (nothing for 3s)".

## Fix (branch `stream-stall`, desktop engine only)

- A fragmented body is detected from its first bytes and decoded forward-only
  from the one request already flowing. Its segment index still gives the
  length. A backward seek in such a track re-opens it at the target (one round
  trip) instead of handing the decoder a seek it would turn into "track
  ended". Forward seeks and every non-fragmented file are unchanged.
- No prefetch in the download settings, so a seek into bytes not yet here is
  answered after one round trip, not after the whole body.
- A load that stalls gets one more attempt on a fresh request before it is
  reported (and not at all if the listener has moved on).

## yt-dlp

Not the cause here: the host answered every request, and a stale yt-dlp shows
up as 403s and server errors, of which there were none. Locally, yt-dlp
2026.8.19 (the latest release) resolves all three ids; a download 403'd on the
first try for two of them and worked on the second, which is YouTube's mood,
not staleness. The host's version is unknown from here: `./update.sh` keeps it
current and is worth running anyway, together with a check that
`.venv/bin/python ffmpeg_path.py` prints a path (without ffmpeg the cache keeps
fragmented files, which were the expensive case).

The host needs nothing for the fix itself: it ships in the desktop app.
