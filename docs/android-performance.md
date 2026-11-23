# Android performance: diagnosis and plan

Status: slices 1, 2, 3 and 5 built on `fix/android-perf` (see "What was built"
at the end of section 7); the rest is still a plan. Written 2026-11-23 against
Android app 0.4.35 and web 0.7.50.

Path short forms used below:
`A/` = `apps/mobile/android/app/src/main/java/app/ember/music/`, `W/` = `apps/web/`.

## 1. Summary

Reported: a black screen on launch, side nav buttons that sometimes do nothing,
bad general performance, and freezes. The code and the one good bug report
point at two separate causes that add up:

1. **Every screen change waits on the host, and the app shows nothing while it
   waits.** The launch needs the document and all scripts from the host before
   anything is drawn. Every tab switch needs a server round trip. There is no
   loading view, no pending state and no request timeout.
2. **The page does too much work on the phone's main thread.** The root player
   component re-renders four times a second while music plays, big lists are
   fetched whole and rendered whole, and nothing is virtualized.

We cannot yet say how much each cause contributes, because nothing measures it.
So the plan starts with cheap performance logging (slices 1 to 6), then fixes in
the order the numbers support (slices 7 to 14).

## 2. What the evidence shows

Report `2026-11-23-15-28-report.json` (motorola edge 60, Android 15, WebView 157).
T0 is 15:25:31 UTC, the native "player service started" (the player plugin starts
the service in the activity's `onCreate`, so T0 is about when the activity opened).

| At | Event | Reading |
|---|---|---|
| T0 - 1.6 s | previous run ended by FORCE STOP | the app was already bad before this launch |
| +8 s | native "up to date" (periodic check, a tiny GET) | scheduled at start, so the host took up to 8 s to answer |
| +30.3 s | first page breadcrumb (route `/`) | this is the moment React finished hydrating, not first paint |
| +30.7 s to +82 s | "Open menu" tapped 6 times | see below |
| +47 s | native "up to date" (reason manual) | the page's 15 s update timer fired about 2 s late at most |
| +60.6 s | `GET /likes` network error | failed 30 s after it was sent |
| +87 s | route `/settings` | 57 s after the first menu tap |
| +98 s | route `/settings/help` | 11 s for the next page |

What this does and does not prove:

- **The main thread was not blocked for 50 s.** A 15 s page timer fired on time
  and taps were delivered to JS throughout. The click breadcrumb is a
  capture-phase listener (`W/lib/logger/client.ts:123`), so it records taps even
  when nothing visible follows.
- **The menu button most likely worked.** Drawer links carry no `aria-label`, so
  taps on them are not logged. The pattern (open menu, wait, open menu again,
  then `/settings`) fits "tapped Settings in the drawer, the drawer closed,
  nothing happened, tried again". The reporter's "pressing options itself took
  a minute" is then the Settings page, not the menu.
- **The host or the path to it was slow in this session.** An 8 s answer to a
  tiny native GET, 30 s until scripts ran, and `/likes` failing after 30 s.
- **It was most likely a cold cache launch.** Web 0.7.50 was committed at
  11:36 UTC that day and the previous session (06:20 UTC) predates it, so
  every script had a new name and was downloaded again.
- **This phone is not a low RAM phone** (a 2025 mid-range model). This report
  says little about memory. Low RAM remains a separate, unmeasured risk.
- We cannot split the first 30 s into "black" and "drawn but dead": nothing
  logs first paint.

Owner's own observation (2026-11-23): switching tabs in the side nav takes a
long time before it responds and the page loads. So the slowness is on every
client navigation, not only at launch. The older reports (11-21 desktop
network outage, 11-22 desktop audio) add no Android evidence.

## 3. Two explanations for slow navigation, weighed

A tab switch in Next.js is: tap, RSC request to the host, the route's script
chunk (if not cached), React render, paint. Either end can be the slow part.

**A. The host is the bottleneck.** Supporting code facts:
- Every page is dynamic (the root layout reads cookies, `W/app/layout.tsx:61`),
  and `W/next.config.ts` sets no `staleTimes`, so each visit refetches.
- `W/proxy.ts:257` runs `authRefresh()` against PocketBase on every matched
  request (pages, RSC, every API call) and sets a new cookie each time. API
  routes then verify again (`W/lib/auth.ts:49`, 5 s cache keyed by token, which
  the fresh cookie keeps missing on sequential calls).
- Each visible client keeps polling: playlists every 30 s from the drawer and
  sidebar, which are always mounted (`W/hooks/useLibrary.ts:100`), Friends
  listening every 30 s on Home (`W/components/FriendsListening.tsx:29`), live
  carlist every 30 s (`W/hooks/useSession.ts:39`), a held long poll for device
  control (`W/lib/remote/cadence.ts:47`), presence every 20 s while playing.
- Query `staleTime` is 30 s (`W/components/providers/QueryProvider.tsx:21`), so
  most page visits refetch whole lists. `/api/likes` and `/api/playlists` use
  `getFullList` (`W/app/api/likes/route.ts:12`, `W/app/api/playlists/route.ts:19`).
- The host also runs yt-dlp, ffmpeg, Python helpers, mix jobs and its own
  rebuild on update, all on the same machine.

**B. The phone's main thread is the bottleneck.** Supporting code facts:
- `W/components/player/PlayerProvider.tsx:230` subscribes the root provider to
  `position`, only to pass it to `useDiscordPresence` (line 1622). While music
  plays the 2000-line provider re-renders at 4 Hz and re-runs its dep-less
  effects (for example line 1907).
- Those are synchronous store updates. React throws away an in-progress
  navigation render when one arrives and starts again. If the new page takes
  longer than 250 ms to render on the phone, the navigation can starve until
  React forces it through after about 5 s, as one long blocking task.
- No list is virtualized anywhere in `W/components` or `W/app`.

**How the logging tells them apart** (one record per navigation, section 5.2):

| Phase | Measured by | Points at |
|---|---|---|
| tap to request start | click time to the RSC request's `fetchStart` | client (main thread busy) |
| request start to sent | `fetchStart` to `requestStart` | connection queue (HTTP/1.1 limit, held poll) |
| sent to first byte | `requestStart` to `responseStart`, plus `Server-Timing` | host (auth, render) or network |
| first byte to end | `responseStart` to `responseEnd`, bytes | network, payload size |
| response to commit | `responseEnd` to `history.pushState` | client (chunk load, render, starvation) |
| during all of it | long task ms, music playing or not | client |

If A, phases 3 and 4 dominate and long task time is low. If B, phase 5
dominates, long task time is high, and it is much worse while music plays.
The server side numbers (section 5.4) confirm A without needing a phone.

## 4. The four problems

### 4.1 Black screen on launch

Ranked hypotheses:

1. **Nothing is drawn while the document loads.** `LaunchGateActivity` finishes
   at once, so the splash goes (`A/LaunchGateActivity.kt:24`). The WebView is
   then an empty view in the theme's background colour
   (`A/ThemeColors.kt:117`), which is near black. Capacitor only falls back to
   `offline.html` on an error, never on slowness
   (`apps/mobile/capacitor.config.ts:37`, `:46`). A slow host, a slow uplink or
   the first launch after a web release gives a long black screen.
   Confirm: native launch timeline (5.3). Reproduce in the sandbox with network
   throttling.
   Fix: a native cover (logo, spinner) over the WebView until the page is
   visible. After 8 s say "Still connecting". After 20 s offer Retry and
   "Play downloads" (the offline page).
2. **Slow first byte from the host.** The document waits on `authRefresh`
   (`W/proxy.ts:257`) and the root layout before any byte is sent.
   Confirm: server timing (5.4) and the page's navigation timing.
   Fix: slice 9 (cheaper session check).
3. **The WebView renderer died.** A dead renderer draws nothing and the
   activity is recreated, which is a second full load
   (`A/RendererGone.kt:45`). A second death within 30 s closes the app.
   Confirm: today this only reaches the server through the page's log. Send it
   through the player log too, with memory figures (5.3).
   Fix: depends on the cause (memory work in slices 10 to 13).
4. **The page is alive but not drawing after a resume.** Seen on 2026-10-09,
   fixed for `state` events (`A/PageStateGate.kt`). The `offline`, `outputs`,
   `cast`, `updateState` and `nativeLog` events are not gated.
   Confirm: event rate counters and the freeze detector (5.2, 5.3).
5. **A WebView version problem.** Confirm: log the WebView package version
   with every launch record and see if reports cluster.

### 4.2 Side nav buttons that stop working

1. **The tap works but the navigation hangs with no feedback.** A drawer link
   closes the drawer first (`W/components/nav/NavLinks.tsx:54`,
   `W/components/nav/Drawer.tsx:56`), then the page stays as it was until the
   RSC answer arrives. Only seven route groups have a `loading.tsx`. Home,
   Settings and Radio have none. It looks random because it depends on host
   latency and on whether music is playing (3.B).
   Confirm: navigation records and rage tap records (5.2).
   Fix: slice 8 (instant pending state, more `loading.tsx`, `staleTimes`).
2. **An invisible overlay eats the tap.** The sheet's backdrop is force
   rendered full screen (`W/components/ui/sheet.tsx:31`). If its 150 ms exit
   transition does not finish on a janky frame, or two modals swap (drawer
   Search link opens the search sheet while the drawer closes), a backdrop or
   an `inert` root can stay behind.
   Confirm: on a rage tap, log what `elementFromPoint` returns (its
   `data-slot` and role) and whether any sheet overlay or `inert` node exists.
3. **A slow tap is read as a long press.** Playlist rows pin on a 450 ms hold
   and cancel the click that follows (`W/hooks/useHold.ts:28`,
   `W/components/nav/PlaylistNavList.tsx:83`). On a busy main thread the hold
   timer can fire before the delayed `pointerup` is handled.
   Confirm: count clicks cancelled by `consumeHold` in the perf log.
   Fix: measure the hold from event timestamps, not from a timer alone.
4. **Opening the drawer is heavy.** It mounts every playlist row with covers,
   a mask on the scroller (`W/components/nav/FadeScroll.tsx:37`) and a backdrop
   blur (`sheet.tsx:35`). `FadeScroll` also measures layout after every render
   (line 26).
   Confirm: interaction timing for "Open menu" (5.2).
   Fix: slice 12.

### 4.3 General performance

Ranked by expected gain, to be re-ranked by the first week of numbers:

1. Navigation is a host round trip with no feedback (section 3.A, slices 8, 9).
2. The root provider re-renders at 4 Hz while playing (section 3.B, slice 10).
3. Whole lists fetched and re-fetched: likes, history, uploads, playlists with
   artworks. Parsing and comparing them runs on the main thread (slice 11).
4. No virtualization: a playlist or Liked songs with thousands of rows, the
   queue sheet, the drawer's playlist list (slice 13).
5. Bridge traffic: each 4 Hz `state` event carries the `cachedIds` and `played`
   arrays, and `cacheState` runs twice per event
   (`A/EmberPlayerPlugin.kt:342`, `:356`) (slice 10).
6. Cold cache after each web release: bundle size is unknown, measure it in
   slice 6. Weekly releases already help.
7. Connection limit: if the host is reached over HTTP/1.1, six connections are
   shared by polls, a held long poll, covers and the RSC request. Log
   `nextHopProtocol` to know.
8. No request timeout in `W/lib/api.ts:171`: a hung call stays pending for 30 s
   or more and its retries follow.

### 4.4 Freezes

Little evidence, so this is where logging matters most.

1. **A pending navigation that looks like a freeze** (same as 4.2.1).
2. **One long blocking render.** A starved navigation forced through after
   about 5 s (3.B), or a big list rendered at once.
3. **Saving the queue.** The player store persists the whole queue to
   `localStorage` on every normal `set` (`W/stores/usePlayerStore.ts:155` to
   `:235`). Position and volume are already excluded. A song change with a
   queue of thousands of songs still serializes all of it.
4. **Renderer killed or unresponsive** (4.1.3). Nothing logs an unresponsive
   renderer today.
5. **Resume after the page was frozen in the background.** State events are
   dropped for up to 15 s while the page resyncs
   (`W/lib/playback/androidBackend.ts:166`), so the bar stands still.
6. **Native main thread stalls.** `CookieManager.flush()` runs on the main
   thread on every page load, pause and stop (`A/CookieFlush.kt:20`,
   `A/EmberActivity.java:63`).

Confirm all six with: long task and freeze records, the native main thread
watchdog, renderer unresponsive callbacks and memory samples.

## 5. Performance logging design

### 5.1 Rules that keep it cheap

- Passive browser observers only. No wrapping of hot functions in production.
- Aggregate in place: counters, fixed histograms, small rings. Never one log
  line per event. Never `JSON.stringify` outside a flush.
- Fixed budgets: page perf state at most 16 KB in memory, one digest at most
  6 KB, at most 20 uploads an hour per device, native buffer reuses
  `PlaybackLog` (200 events, batches of 25, `A/PlaybackLog.kt:153`).
- Flush on `visibilitychange` hidden and every 5 min while the page is open
  (the owner wants every member's sessions, 2026-11-23).
- Timers only while the page is visible. Native memory reads off the main
  thread, at most every 5 min.
- Target cost: under 1 ms of main thread per minute. Slice 6 checks this.

### 5.2 Page side (new `W/lib/perf/`, framework-free like the rest of `lib/`)

| Signal | Source | Kept as |
|---|---|---|
| Launch phases | `PerformanceNavigationTiming` (first byte, DOM ready), `paint` (first contentful paint), a `hydrated` mark in `LoggerInit`, first idle after it | one record |
| Cold cache | script `transferSize` total and count, `nextHopProtocol` | fields on the launch record |
| Long tasks | `PerformanceObserver` `long-animation-frame` (fallback `longtask`), buffered | count, total ms, max, top 5 script sources per window |
| Tap to response | `PerformanceObserver` `event` (over 100 ms): input delay, handler time, time to paint, target `aria-label` or `data-slot` only | ring of 20 slow interactions |
| Navigation | click on a same-origin link, RSC request timing (`resource` entries with `_rsc`), `Server-Timing`, `pushState`, next frame | ring of 20 records, phases as in section 3 |
| Rage taps | 3 or more taps on one target in 5 s | record with pending navigation, overlay under the finger, long task ms |
| API calls | `resource` entries for `/api/*`, ids stripped | per route: count, median and max wait, bytes (cap 40 routes) |
| Freeze | 2 s heartbeat while visible, drift over 2 s | record with gap and visibility |
| JS heap | `performance.memory` where present, `navigator.deviceMemory` | sample every 60 s, ring of 30 |
| Sizes | DOM node count, queue length, query cache count, likes and history lengths, logger ring length | same sample |
| Native event rate | counters in `androidBackend` `onState`, auto cache and offline listeners | per event: count and max per 10 s, sampled payload size |
| Render churn | `PlayerProvider` renders per second | dev and test builds only |
| Live timers and listeners | wrapped `setInterval`, `setTimeout`, `addEventListener` counts | dev and test builds only, behind `?perf=debug` |

Also fix a gap: log taps on nav links by path (no text), so the next report
shows what was pressed.

### 5.3 Native side (new `A/PerfLog.kt`, sent through `PlaybackLog`)

`PlaybackLog` posts to `/api/native-log` without the page, so these arrive even
when the page never loads, which is exactly the black screen case.

- **Launch timeline**, one event: process start, `LaunchGateActivity` create,
  `EmberActivity` create start and end, `loadUrl`, page started, page visible
  (`onPageCommitVisible` if this Capacitor version passes it on, else the
  page's first paint), page hydrated (the page calls a new
  `EmberApp.pageReady`). Fields: cold or warm, WebView version, network type.
- **`launch.stuck`**: no visible page after 10 s and again after 30 s.
- **Memory**: `ActivityManager.getMemoryInfo` (available, low flag),
  `memoryClass`, `isLowRamDevice`, `Debug.getMemoryInfo` total PSS, every
  5 min in the foreground and on every `onTrimMemory` or `onLowMemory`.
- **Renderer gone**: already logged to the page (`A/RendererGone.kt:47`). Also
  send it through `PlaybackLog` with crash flag, uptime and the last memory
  sample.
- **Renderer unresponsive**: `WebViewRenderProcessClient` callbacks
  (`androidx.webkit` is already a dependency).
- **Main thread watchdog**: a background thread posts to the main looper every
  second. No run within 3 s logs `main.stall` with a short main thread stack.
- **Event rate to the page**: per event name, count per minute and sampled
  payload size, counted where plugins call `notifyListeners`.
- **Exit records**: add `pss` and `rss` to the existing "last run ended" event
  (`A/PlaybackLog.kt:457`), and the first lines of the trace for an ANR.

### 5.4 Server side (there is no request timing today)

`withRequestLog` records a duration only for failures
(`W/lib/logger/withRequestLog.ts:91`), and pages and RSC requests are not
timed at all. Add `W/lib/perf/serverTiming.ts`, registered from
`W/instrumentation-node.ts`:

- Time every request with Node's `diagnostics_channel`
  (`http.server.request.start`, `http.server.response.finish`). No patching,
  and it covers pages, RSC, API and files alike.
- Per route (ids stripped, RSC marked): count, median, p95, max. Bounded map.
- `proxy.ts` times `authRefresh` and adds `Server-Timing: auth;dur=N` so the
  page can read it.
- Host health in the same record: event loop delay
  (`perf_hooks.monitorEventLoopDelay`), load average, running download and
  Python job counts.
- Output: one `perf` entry in the server log every 5 min, plus one warn line
  for any request over 2 s with its request id.

### 5.5 Where it shows up

- **Manual bug reports**: a `perf` block in the client snapshot
  (launch record, last navigations, slow interactions, long task summary,
  memory samples, event rates). The reporter's native perf events come with the
  server entries as today.
- **Per session, in batches** (owner, 2026-11-23): every signed-in person's
  app collects its session and sends what happened since its last batch
  every 5 min while open and when it is left or closed (`sendBeacon` on
  `pagehide` and on hidden), to a rate-limited `POST /api/perf-log`. A batch
  (at most 6 KB) is numbered from 1 and carries the page's start time, the
  window's aggregates and each navigation, freeze, rage tap and slow tap as
  its own event. The host stores each batch as it arrives in its own files,
  `logs/perf-YYYY-MM-DD.jsonl`, kept 7 days, at most 1 MB per member per
  day, tagged with the member's id, the session id, the app version, the
  shell and the device, so a session that ends abruptly keeps the batches
  it sent. Only an admin reads them back, grouped per session:
  `GET /api/admin/perf` and `npm run perf` list sessions, and
  `npm run perf -- <session>` prints one session's events and batches
  merged in order, naming any batch that never arrived.
- **Nothing on the spot**: no automatic perf report. A very slow launch,
  navigation or freeze is just an event in the session's log.
- **Daily digest** (`W/lib/reports/digest.ts`): a short perf section with
  launch and navigation medians and p95, worst routes on the host, renderer
  deaths, low memory events, heap slope per device model. Only while the
  perf channel below has nowhere to post (no webhook, or
  `PERF_ROLLUP_DISABLED=1`); otherwise the numbers live in the perf channel.
- **Perf channel** (owner, 2026-11-23; `W/lib/reports/perfRollupJob.ts`):
  every 6 hours (00, 06, 12, 18 UTC) one Discord message with the
  collective performance of every device, one embed per platform, always
  all five (Android, iOS, Windows, macOS, Linux; an empty one says so),
  titled with the window. Each batch carries the device's `os` (the
  Capacitor platform in the app, else the user agent, an iPad asking for
  the desktop site counting as iOS); browser users count under their OS
  and the shell (phone app, desktop app, browser) is the sub-breakdown.
  Batches from older apps get it from the request's user agent, or the
  shell, else `other` (counted in the totals and the file only). Per
  platform: sessions, members (a count), foreground hours, launch (first
  paint and ready) p50 and p95, navigation count, p50, p95 and max, long
  task ms per foreground minute, freezes, rage and slow taps, heap p50 and
  max and its growth per session (last minus first, p95: the leak signal),
  DOM nodes max, the typical device's RAM and cores, the 3 slowest routes,
  and **side nav**: taps on a link in the side nav or the phone's drawer
  (navigation events carry the tapped link's `data-nav-area`), per
  destination the count, p50 and p95 tap to shown, where the time went
  (p50 host wait, request sent to first byte, against p50 page work,
  response end to the route change) and how many were re-tapped before
  they loaded. A `perf-rollup.json` file comes with it: the same numbers
  plus one row per session with the member and session ids replaced by a
  short salted hash (`PERF_ROLLUP_SALT`, else a random salt kept in
  `logs/perf-rollup-salt`), capped near 1 MB by leaving out the oldest
  sessions. No ids, emails, songs or artists in either. A window with no
  sessions is not posted; `logs/perf-rollup-state.json` keeps a window to
  one post across restarts, and a refused post is tried 3 times, 30 min
  apart. Where it posts: `DISCORD_PERF_WEBHOOK_URL` as it is, else the
  bug-report webhook into the perf thread of #bug-reports
  (`?thread_id=`, `DISCORD_PERF_THREAD_ID`, default
  1574541246045618378). To check it after a release, as an admin:
  `npm run perf -- --rollup` (a dry run of the last 6 hours,
  `GET /api/admin/perf-rollup?hours=N`, nothing posted; `--json` for the
  whole answer) and `npm run perf -- --rollup --post` (posts now,
  `POST /api/admin/perf-rollup`, without taking the scheduled window).

### 5.6 Kill switch

- Host: `EMBER_PERF_LOG=off` makes `/api/perf-log` answer `{ off: true }`; the
  page stops collecting for the session and tells the native side (the page
  asks with `GET /api/perf-log` 5 s after every page load and every 30 min
  while open, and every upload's answer says it again). It also stops the server's request
  timing, its `Server-Timing` headers and the perf channel's posts
  (`PERF_ROLLUP_DISABLED=1` stops only the posts).
- Device: none. Every signed-in person's app sends (owner, 2026-11-23); the
  "automatic reports" setting covers crash reports only.
- A `sample` value in the same answer, `EMBER_PERF_SAMPLE` (default 1),
  rolled once per page session.
- Observers disconnect and timers clear when switched off. Covered by a test.

## 6. Memory leak check plan

1. **Navigation loop in headless Chromium** (`tests/perf-leak.test.mjs`, on the
   usual sandbox, app 3050 and PocketBase 8088, with the fake native player
   from `tests/android-player-ui.test.mjs`). Android user agent, phone
   viewport, CPU throttled 4x. Seed a 2000 song playlist. Run 50 cycles of
   Home, Library, the big playlist, Search, Settings, drawer open and close,
   player open and close, with the fake player sending 4 Hz state. Every 10
   cycles force a GC over CDP and read `Runtime.getHeapUsage` and
   `Performance.getMetrics` (heap, nodes, listeners). Fail when, after the
   first 10 cycles, heap grows more than a set amount per cycle or nodes and
   listeners do not return to within 5 percent. On failure save two heap
   snapshots to compare.
2. **Idle soak**: 30 min on Home "playing". Heap must stay flat and requests
   per minute must stay under a budget (this also guards the polling load).
3. **Bounded structure tests** (unit): the logger ring, the new perf rings,
   and the module caches that grow today: `consoleSeen`
   (`W/lib/logger/client.ts:40`), `W/hooks/useCoverColor.ts:9`,
   `W/hooks/useScrollMemory.ts:6`, `W/lib/trackMeta.ts:40`.
4. **Native**: LeakCanary and StrictMode in the "Ember Test" build only. A
   script that recreates the activity 20 times and plays for 30 min, comparing
   `dumpsys meminfo app.ember.music` before and after.
5. **Field**: heap and PSS slope per hour per device model, and renderer kills,
   in the daily digest.

## 7. Implementation plan

Small slices, each with tests, logging first. Tier: S = one subsystem (Codex or
the standard worker), L = several subsystems (Codex, with the opus worker as
fallback). Claude reviews and commits; nothing goes to `main` directly.

| # | Slice | Main files | Test | Tier |
|---|---|---|---|---|
| 0 | Baseline, no code: host log for 2026-11-23 15:20 to 15:30 UTC, throttled sandbox numbers, check the Capacitor listener API | none | notes added to this doc | S |
| 1 | Page perf core: rings, observers, freeze heartbeat, memory sampler, kill switch | `W/lib/perf/*`, `W/components/LoggerInit.tsx` | vitest with a fake `PerformanceObserver`, size cap tests | S |
| 2 | Navigation, tap and rage tap records, nav link breadcrumbs | `W/lib/perf/nav.ts`, `W/lib/logger/client.ts` | unit, plus a UI test that delays the RSC answer and checks the phase split | S |
| 3 | Server request timing and host health | `W/lib/perf/serverTiming.ts`, `W/instrumentation-node.ts`, `W/proxy.ts`, `withRequestLog.ts` | unit for histograms, `proxy.test.ts` header test | S |
| 4 | Native perf log: launch timeline, stuck launch, memory, renderer, watchdog, event rates, exit sizes | `A/PerfLog.kt`, `A/EmberActivity.java`, `A/EmberAppPlugin.kt`, `A/RendererGone.kt`, `A/PlaybackLog.kt` | JVM unit tests for the pure rules | L |
| 5 | Delivery: perf block in reports, `/api/perf-log`, digest section, kill switch end to end | `W/app/api/perf-log/`, `W/app/api/bug-report/route.ts`, `W/lib/reports/digest.ts`, `W/lib/autoReport.ts` | route tests, digest tests | L |
| 6 | Leak and navigation harness, bundle size report, logging cost check | `tests/perf-leak.test.mjs`, `tests/perf-nav.test.mjs` | the harness itself, wired into `release:check` | S |
| 7 | Launch cover with slow and stuck states | `A/EmberActivity.java`, new `A/LaunchCover.kt`, layout resources | JVM tests for the state rules, test APK check | S |
| 8 | Navigation feedback: pending state on tap, `loading.tsx` for Home, Settings, Radio and the rest, `staleTimes` | `W/components/nav/*`, `W/app/(app)/**/loading.tsx`, `W/next.config.ts` | component tests, `perf-nav` before and after | S |
| 9 | Cheaper session check: refresh at most once a minute per token, no cookie rewrite per request, one shared verified cache | `W/proxy.ts`, `W/lib/auth.ts` | `proxy.test.ts`, the authorization suites | S |
| 10 | Stop the 4 Hz root render, slim the native tick | `W/components/player/PlayerProvider.tsx`, `W/hooks/player/useDiscordPresence.ts`, `A/EmberPlayerPlugin.kt`, `W/lib/playback/androidBackend.ts` | render counter test, `android-player-ui`, nav timing while playing | L |
| 11 | Lighter data: lean or paged likes, history and playlists, longer `staleTime` for big lists with invalidation on change, polls paused when hidden, request timeout, queue save off the song change path | `W/app/api/likes`, `W/hooks/useLibrary.ts`, `W/lib/api.ts`, `W/stores/usePlayerStore.ts` | route and hook tests, soak request budget | L |
| 12 | Drawer: mount content only when open, no blur or mask on phones, `FadeScroll` effect, hold timing, overlay cleanup | `W/components/nav/Drawer.tsx`, `FadeScroll.tsx`, `W/components/ui/sheet.tsx`, `W/hooks/useHold.ts` | `Drawer.test.tsx`, a tap test under CPU throttle | S |
| 13 | Virtualize long lists, lazy and small covers | playlist, Liked, Library and queue lists | leak harness node counts, scroll test | L |
| 14 | Freeze hardening: gate the other native event streams, renderer unresponsive handling, cookie flush off the main thread | `A/EmberOfflinePlugin.kt`, `A/EmberPlayerPlugin.kt`, `A/CookieFlush.kt` | JVM tests, resume test with the fake player | S |

Slices 1 to 3 can run in parallel. Slice 5 needs 1 to 4. Release 1 to 6 first
and collect about a week of numbers, then order 7 to 14 by what they show.
Slices 7 and 8 are safe to start earlier: they help under either explanation.
Slice 9 changes how sessions are checked, so it needs a security review.

### What was built (slices 1, 2, 3, 5)

- `W/lib/perf/`: `core.ts` (rings, long-animation-frame or longtask, event
  timing, paint, resource observers, 2 s freeze heartbeat and 60 s memory
  sample while visible, kill switch), `nav.ts` (navigation phases, rage taps),
  `digest.ts` (one batch, 6 KB), `client.ts` (boot from `LoggerInit`,
  batches), `switch.ts` (session kill switch and the
  `onPerfSwitch` hook the native side will use), `serverTiming.ts`,
  `hostSwitch.ts`, `store.ts`, `upload.ts`, `sessions.ts`, `reportBlock.ts`.
- Nav links carry `data-nav` (static names; playlists are "Playlist" plus the
  path with its id taken out) and their area (`data-nav-area` drawer,
  sidebar, bottom). Clicks cancelled by a long press count as `hold.cancel`.
- Server: `http.server.*` diagnostics channels and `Server-Timing: auth` from
  `proxy.ts`. No `handler` header after all: Next 16 drops a route's
  `server-timing` when the proxy set one, and the server log has the
  request times anyway.
- Delivery: the perf block in manual bug reports, session batches to
  `POST /api/perf-log`, `GET /api/admin/perf`, `npm run perf`, the perf
  channel every 6 hours (`W/lib/perf/os.ts`, `platformRollup.ts`,
  `W/lib/reports/perfRollupJob.ts`, `perfRollupEmbeds.ts`,
  `W/app/api/admin/perf-rollup`), and a "Performance" section in the daily
  digest while the perf channel is off. No automatic perf reports.
- For native slice 4: the digest counts native events named `renderer.gone`,
  `renderer.crash`, `renderer.unresponsive`, `memory.low` and `memory.trim`.
- Left out for now: the dev only render churn and timer counters
  (`?perf=debug`), the query cache size, and native event rate counters in
  `androidBackend` (slice 4 counts them on the native side).

## 8. Open questions for the owner

1. How do phones reach the host (Tailscale Funnel, Cloudflare, LAN), and what
   is the host's upload speed and hardware?
2. Was the host updating, building or running a heavy job on 2026-11-23
   around 15:25 UTC? Can we have the server log for that window?
3. Your own slow tab switches: which phone and network, was music playing,
   and were you on the host's Wi-Fi?
4. Who else saw the black screen, on which phones, and only at launch or also
   when coming back to the app?
5. ~~May all devices send the small perf digest by default?~~ Yes (2026-11-23):
   every signed-in person's app sends its session in batches, whatever the
   automatic reports setting says.
6. Is a daily Discord perf section enough, or do you also want an admin page?
7. Is it acceptable that a sign-out or ban takes up to 60 s to apply
   everywhere (slice 9)?
8. Which phone is the target for "good enough", and how big is the largest
   Liked songs list?

## 9. Proposal: the session check in `proxy.ts` (not done, needs a security review)

Today `proxy.ts` calls `users.authRefresh()` on every request it covers
(every API poll, `/pb/*`, audio range requests) and writes the new token back
as the `pb_auth` cookie. Because the token changes on every request, the
route's own 5 s verified cache (`lib/auth.ts`, keyed by token) always misses
and refreshes again: about two PocketBase auth round trips per API request,
and the `verified` map gains a new key each time. The background fixes on
`fix/android-background` cut the number of polls, but each one still costs
this double refresh.

Proposed, in this order, each step reviewable on its own:

1. One shared verified cache. Move the token to record cache out of
   `lib/auth.ts` into a small module both `proxy.ts` and the routes use, so a
   request verified by the proxy is not verified again by its route.
2. Verify, do not rotate, on most requests. In the proxy, answer from that
   cache (keyed by a hash of the token, as today) for up to 60 s; only on a
   miss call PocketBase. Rotate the cookie (a real `authRefresh` and
   `Set-Cookie`) only when the token is within its last part of life (for
   example under a day left), not on every request.
3. Cap the cache (LRU, a few thousand entries) instead of sweeping past 500.

What the review has to accept: a sign-out, password change or ban takes up
to the cache lifetime (60 s) to apply on requests that hit the cache (open
question 7 above), and a stolen token keeps working until its own expiry
unless it is refused by PocketBase on a miss. Sign-out should therefore
also drop the token from the cache on this server, and the admin's ban
action should clear the cache for that user. Tests to keep green:
`proxy.test.ts` and the authorization suites; add one that a burst of API
calls with one cookie makes one PocketBase call and sets no new cookie.
