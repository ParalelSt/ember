# Tests

> Sandbox servers and Discord: the bug-report route posts to the app's default
> webhook (the owner's channel) unless `DISCORD_BUG_REPORT_WEBHOOK_URL` is set.
> Reports from `@ember.test` accounts are dropped when the default webhook is in
> use, so a test run cannot spam the channel; still set the variable to a local
> sink (`http://127.0.0.1:4312/hook`) on every sandbox you start.

## Unit tests

`npm run test:unit` from the repo root. Vitest, no sandbox, no PocketBase,
no server: pure `lib/` functions, store actions, hooks and presentational
components render in `happy-dom`. Files live next to the code they test, as
`*.test.ts` or `*.test.tsx` (for example `lib/songKey.ts` next to
`lib/songKey.test.ts`). Run just the web app's tests with
`npm run test:unit -w apps/web`, or watch mode with
`npm run test:unit:watch -w apps/web`.

Test folders, `apps/web/`:

- `lib/`, `lib/playback/`: pure functions, format/shuffle/artwork/layout/
  collections helpers, `chooseDuration`, `resumePosition`, `songKey`,
  `queueNav`, `radio`, `shortcuts`. Also `lib/lintRules.test.ts`, a unit
  test (not an eslint rule) that scans `app/` and `components/` for banned
  class-string patterns (raw `oklch(`, `to-[`, the old artwork size pairs,
  the type utility strings before they existed), and holds the safe-area
  inset to one definition: `--safe-top` / `--safe-bottom` on `:root` in
  globals.css, two utility classes that spend them, and no component with
  an `env(safe-area-inset-*)` string of its own.
- `lib/import/`: playlist import (docs/imports.md). `url` (Spotify, short
  link, YT Music and YouTube links, and what is rejected), `embed` (the
  Spotify embed-page parser against saved pages in `tests/fixtures/imports/`:
  a 50-track playlist, a full 100-track one, Spotify's "Page not found"
  state, a changed page shape) and `score` (the fixture table: exact, feat.,
  remix either way, live, clean vs explicit, length off by 2, 5 and 40 s,
  Topic channel vs fan upload, plus the reasons text and the 75 / 50
  thresholds). Background imports: `jobState` (the queued, running, paused,
  done, failed, cancelled table, what is final, source positions),
  `runner` (an in-memory store and a fake matcher: batches of 8, the cursor,
  pacing, a restart resuming from the cursor without adding twice, the 5 /
  20 / 60 s backoff then a pause for Retry, cancel mid-way and mid-backoff,
  never two loops at once), `store` (a small fake PocketBase:
  position-preserving inserts, review picks, a re-match swapping in place,
  Remove song, a half-made import cleaned up), `records`, `reasons`, `rows`
  (the playlist's rows with the import's placeholders in source order) and
  `nav` (what each sidebar row says).
- `components/import/`: `ReviewSheet` (keys 1 to 3 pick, S skips, keys
  left alone while typing a search, search then use, all done, re-match
  mode), `ImportBanner` (progress, backoff, Retry, the Done counts) and
  `ImportTrackList`. With them, `components/track/menus/CreatePlaylistDialog`
  (the Tabs and the link step: preview, the 100-song note, Create closing the
  dialog and opening the playlist), `components/track/menus/TrackMenu` (the
  re-match item) and `components/nav/PlaylistNavList` (the ring and "18 of
  42").
- `lib/reports/`: the report libs behind bug reports and the daily digest:
  `fingerprint` (grouping two occurrences of one bug together),
  `timeline`/`selectTimeline` (the readable Evidence block), `history`
  ("seen before" counts), `digest` (grouping and formatting), `discord`
  (webhook selection and 1024-char field splitting) and `digestJob`
  (`shouldRunNow`, `digestHour`, and `runDigest` against a fake webhook and
  a fake model: quiet day, grouping, a failed summary degrading to the
  groups alone, scrubbing, and the day marker).
- `stores/`: `usePlayerStore` actions (toggleShuffle, cycleLoopMode,
  toggleMuted).
- `components/primitives/`, `components/page/`: `Artwork`, `PlayButton`,
  `LikeButton`, `PageTitle`/`SectionHeader`/`Eyebrow`/`EmptyState`,
  `CollectionHeader`: pure, props-in components.
- `components/track/`: `TrackRow`, `TrackList`, `TrackCard`, `TrackShelf`.
- `components/nav/`: `NavLinks`, `MobileNav` (the safe-area class and the
  search-overlay click), and `ChangelogBadge` (the What's new row's New tag
  in `Sidebar` and `Drawer`, the dot on the `TopBar` menu button).
- `components/changelog/`: the What's new page, row, pill and hide switch.
- `components/player/`: `SeekBar`, `TransportControls`, `VolumeControl`,
  `NowPlayingSummary`, `PhonePlayerBar` (the two-row phone bar: the name on
  its own row, the approved tap sizes, the shared safe-area class),
  `PlayerBar` (that the md layout is untouched: the same footer, grid,
  three columns and control sizes it had before the phone bar was split
  out of it), and `PlayerProvider.test.tsx` (a mocked-backend
  wiring test: playTrack loads and plays once, a fresh track's position
  resets rather than inheriting another track's playhead, a backend pause
  event persists the position).
- `hooks/`, `hooks/player/`: `useTrackActions`, `useCollections`,
  `useLikeToggle`, and the five `PlayerProvider` hooks
  (`usePositionPersistence`, `useRadioExtend`, `useKeyboardShortcuts`,
  `useRemoteCommands`, `useDiscordPresence`), each with a shared fake
  `AudioBackend` from `apps/web/test-utils/fakeBackend.ts` (not shipped:
  it imports `vitest` and lives outside `lib`/`components`/`hooks` proper.
  `tsc --noEmit` still type-checks it, since `tsconfig.json` includes every
  `**/*.ts`; `next build` does not, since nothing under `app/` or
  `components/` imports it).
- `components/`, `app/(app)/search/`: `FriendsListening`, `OnlineOnly`,
  the Search page with mocked queries (rate-limit message, recents
  remove).

Guard rails enforced outside the test files themselves:

- `apps/web/eslint.config.mjs` has a `no-restricted-imports` rule: files
  anywhere under `components/{primitives,page,track,library,nav}/` cannot
  import `@/hooks/*`, `@/stores/*`, `@tanstack/react-query` or
  `@/components/player/PlayerProvider`: they take data as props. A file
  that is genuinely data-aware today is listed as an explicit override in
  the config with a comment (`components/nav/Sidebar.tsx`,
  `components/nav/Drawer.tsx`, `components/track/TrackPageClient.tsx`,
  `components/track/menus/**`).
  `lib/**` has the mirror rule: no `react`, `next/*` or `@/components/*`
  imports, with the same override pattern for the few pre-existing files
  that need one.

## Host scripts: watchdog and crash reports

Two standalone runners for the crash logging in `start-static.sh` (see
SETUP.md, "Crash logging"). No sandbox, no PocketBase, no build, no network:
run them from the repo root.

```bash
bash tests/watchdog.test.sh        # or: npm run test:watchdog      (about 40 s)
node tests/crash-report.test.mjs   # or: npm run test:crash-report  (a few seconds)
```

`watchdog.test.sh` (72 checks) copies `start-static.sh`, `update.sh` and
`scripts/crash-report.mjs` into a temp root per scenario, so the repo's own
`logs/` is never touched, and supervises fake services (`WATCHDOG_CMD_PB`,
`WATCHDOG_CMD_NEXT`) with `WATCHDOG_BACKOFF="0 0 0"`, `WATCHDOG_MAX_CRASHES=3`
and `WATCHDOG_WINDOW=60`. Posts go to `tests/fake-discord.mjs` on a random
port. It covers: a crashing service restarted with one post per crash, then a
single give-up post and no immediate restarts, while the healthy one keeps
serving; service output in `logs/*.log` and the terminal; SIGTERM stopping
both services with no crash post, removing `watchdog.pid` and `ember.lock`,
and leaving no process behind; a leftover lock with a dead pid producing the
unclean-shutdown post; SIGHUP posting the terminal-closed message and stopping
cleanly; `update.sh`'s stop sequence (`UPDATE_STOP_ONLY=1`, test-only) stopping
the watchdog before the ports with no crash post and no restart; a
SIGKILLed watchdog whose supervisors then refuse to restart a dead service; a
service that ignores SIGTERM being SIGKILLed after the 8 s grace; the watchdog
in its own process group getting SIGHUP twice 50 ms apart (as a closing PuTTY
session does), with exactly one terminal-closed post and a clean stop; a
service that gives up, fails one quiet retry without posting, then stays up
and posts "back up after 2 attempts" once (`WATCHDOG_RETRY=1`,
`WATCHDOG_RECOVERED_AFTER=2`); and a real `update.sh --no-start` run against a
local git origin with a fake `npm` on `PATH`, checking the watchdog and the web
app were already stopped when `npm ci` began.

`crash-report.test.mjs` (34 checks): webhook resolution order (crash env var,
bug-report env var, `.env.local`, then `DEFAULT_WEBHOOK_URL` extracted from a
fixture copy of the route, plus a check that the real route still has one to
extract), log-tail scrubbing of a bearer token and cookies, the rate-limit
state (10 an hour, one mute notice, then silence), the multipart post (embed
title/text/footer, no mentions, last 50 lines attached, an empty log attaching
nothing, the title scrubbed too), the poster surviving two SIGHUPs and a SIGINT
mid-post, and exit 0 with one stderr line when the webhook answers 500 or is
unreachable. `EMBER_LOG_DIR` keeps its state file in a temp dir.

The server-side catch (`apps/web/lib/crashHandlers.ts`) is unit-tested in
`apps/web/lib/crashHandlers.test.ts`, run by `npm run test:unit`: it logs,
spawns the poster once per distinct message, keeps the process running after
both an uncaught exception and an unhandled rejection, and never throws when
logging and spawning both fail.

## Ember's own ffmpeg

No sandbox, no network: run from the repo root with a Python that has
`imageio-ffmpeg` (`PYTHON_BIN`, else `.venv/bin/python`).

```bash
node tests/ffmpeg-resolve.test.mjs   # or: npm run test:ffmpeg   (a few seconds)
.venv/bin/python -m unittest tests/test_ffmpeg_path.py            # the Python half alone
```

`ffmpeg-resolve.test.mjs` (9 checks) copies `update.sh` into a temp root with
a fake `.venv` (`pip` only logs its arguments, `python` hands over to the real
one) and runs just its ffmpeg step (`UPDATE_FFMPEG_ONLY=1`, test-only, no git)
with `PATH=/usr/bin:/bin`: pip is asked for `imageio-ffmpeg`,
`.venv/bin/ffmpeg` becomes a symlink into `imageio_ffmpeg` that runs
`-version`, a stale link is replaced on the next run, no venv means the step is
skipped, and a missing binary is a warning while the update carries on. Then it
runs `tests/test_ffmpeg_path.py` (9 unittests): `ffmpeg_path.py` finds the
bundled binary with an empty `PATH`, falls back to `PATH`, says "ffmpeg is
missing: run ./update.sh" when there is none, `transcribe.py`'s decode works
with an empty `PATH` and fails with that message without ffmpeg, and every
yt-dlp option set in `player.py` carries `ffmpeg_location`.

## Sandbox tests

Runnable checks against a **sandbox** copy of the app. Nothing here touches
your live PocketBase data, your real Discord channel, or any paid API: the
external services are faked in-process.

> Never point these at the running production stack (`:3000` / `:8090`). The
> whole point of the sandbox is that a test can't damage anything.

## Sandbox setup

From the repo root:

```bash
# 1. Copy the database somewhere disposable
SB=/tmp/ember-sandbox && mkdir -p "$SB" && cp -R pocketbase/pb_data "$SB/pb_data"

# 2. PocketBase on a spare port
./pocketbase/pocketbase serve --http=127.0.0.1:8091 --dir="$SB/pb_data" \
  --hooksDir=pocketbase/pb_hooks &

# 3. Build once (turbopack dev is unreliable here: always test a real build).
#    POCKETBASE_URL matters HERE, not only at start: the browser's /pb/* proxy
#    target is baked in at build time. Without it the build points at :8090 and
#    every sign-in through the form fails with a 500 (the tests never noticed
#    because they inject a session cookie instead of logging in).
cd apps/web && POCKETBASE_URL=http://127.0.0.1:8091 npx next build --webpack

# 4. Two app servers: one WITH an AI key, one WITHOUT.
#    MAX_UPLOAD_MB=1 keeps the uploads "too large" case fast.
#    The scheduled daily digest only runs with DIGEST_ENABLED=1, so it never
#    fires from a test server; the suite triggers it by hand instead.
POCKETBASE_URL=http://127.0.0.1:8091 MUSIC_DIR="$SB/music" MAX_UPLOAD_MB=1 \
ANTHROPIC_API_KEY=test-key ANTHROPIC_BASE_URL=http://127.0.0.1:4311 \
BUG_TRIAGE_MODEL=claude-sonnet-5 \
DISCORD_BUG_REPORT_WEBHOOK_URL=http://127.0.0.1:4312/hook \
npx next start -p 3005 &

POCKETBASE_URL=http://127.0.0.1:8091 MUSIC_DIR="$SB/music" \
ANTHROPIC_API_KEY= \
DISCORD_BUG_REPORT_WEBHOOK_URL=http://127.0.0.1:4312/hook \
npx next start -p 3006 &
```

`POCKETBASE_ADMIN_EMAIL` / `POCKETBASE_ADMIN_PASSWORD` come from
`apps/web/.env.local`; the tests default to the values in `.env.example`.

## Running

```bash
node tests/ai-triage.test.mjs     # or: npm run test:triage

# UI check: needs a browser driver and the standalone fakes
npm i -D playwright-core
node tests/fake-anthropic.mjs &
node tests/ai-triage-ui.test.mjs  # or: npm run test:triage-ui

# Cross-user authorization
node tests/authorization.test.mjs                   # or: npm run test:auth
node tests/session-authorization.test.mjs           # or: npm run test:sessions
node tests/fake-songsterr.mjs &                     # port 4330; app needs SONGSTERR_BASE=http://127.0.0.1:4330
node tests/tabs.test.mjs                            # or: npm run test:tabs
node tests/tabs-ui.test.mjs                         # or: npm run test:tabs-ui
node tests/tabs-sync.test.mjs                       # or: npm run test:tabs-sync
node tests/tabs-generate.test.mjs                   # or: npm run test:tabs-generate
MUSIC_DIR="$SB/music" node tests/tabs-text.test.mjs # or: npm run test:tabs-text (pasted text tabs: route, chain, tab page follows the song, search links; PB restarted with this branch's pb_hooks)
node tests/fake-ug.mjs &                            # port 4331; app needs UG_BASE=http://127.0.0.1:4331
MUSIC_DIR="$SB/music" node tests/tabs-fetch.test.mjs # or: npm run test:tabs-fetch (tabs found on Ultimate Guitar: once per song, drawn, follows the song; PB restarted with this branch's pb_hooks)
node tests/transcribe-timing.test.mjs              # or: npm run test:transcribe-timing (no server needed; python3 or PYTHON_BIN)
node tests/preferences-ui.test.mjs                  # or: npm run test:preferences-ui (plugin switches across two devices; PB restarted with this branch's pb_hooks)
node tests/themes-ui.test.mjs                       # or: npm run test:themes-ui (themes: Settings > Appearance picks, a custom theme, sharing and a second person using it, first paint from the cookie with JS off, the /pb rules; SHOT_DIR=dir saves every preset on Home and Appearance at 390 and 1300; PB_URL/APP_URL, default 8089/3051)
node tests/pranks-ui.test.mjs                       # or: npm run test:pranks-ui (the admin's Control room page and a playing target in a second browser context: ping, upload a sound and play it over the target's ducked music, a repeat every minute landing twice, Stop, Stop everything, the off switch, library and media gate, rules, caps, 45 s expiry; PB restarted with this branch's pb_hooks, the app started with PRANK_TICK_INTERVAL_MS=1000)
node tests/pranks-realtime.spike.mjs                # or: npm run test:pranks-spike (does PocketBase SSE stream through /pb? under next start it does not: gzip buffers it)
node tests/android-player-ui.test.mjs               # or: npm run test:android-ui
node tests/offline-android-ui.test.mjs              # or: npm run test:offline-ui
node tests/offline-page.test.mjs                    # or: npm run test:offline-page (no server needed; also checks the page takes the theme variables Android publishes, docs/themes.md)
node tests/resume-position.test.mjs                 # or: npm run test:resume
node tests/playback-position.test.mjs               # or: npm run test:position
node tests/public-origin.test.mjs                   # or: npm run test:origin
node tests/toggles-ui.test.mjs                      # or: npm run test:toggles
node tests/collections.test.mjs                     # or: npm run test:collections (no server needed)
node tests/library-collections-ui.test.mjs          # or: npm run test:library-ui

# Privacy switches
node tests/privacy.test.mjs                         # or: npm run test:privacy

# What's new: New tag, menu dot, Mark all as read, hide switch (needs PocketBase
# restarted with this branch's pb_hooks; SHOTS_DIR=<dir> saves screenshots)
node tests/changelog-ui.test.mjs                    # or: npm run test:changelog-ui

# Desktop update feed (needs its own server: see the section below)
node tests/desktop-update.test.mjs                  # or: npm run test:update

# Where audio comes from (needs its own server: see the section below)
node tests/desktop-logger.test.mjs                  # or: npm run test:desktop-logger
node tests/stream-source.test.mjs                   # or: npm run test:stream
node tests/stream-fallback.test.mjs                 # or: npm run test:stream-fallback
node tests/stream-range.test.mjs                    # or: npm run test:stream-range
node tests/stream-fastfail.test.mjs                 # or: npm run test:stream-fastfail (starts its own server)

# Custom uploads (MUSIC_DIR must match the server's)
MUSIC_DIR="$SB/music" node tests/uploads.test.mjs   # or: npm run test:uploads
node tests/uploads-ui.test.mjs                      # or: npm run test:uploads-ui

# Feature and fix requests (needs DISCORD_FEATURE_WEBHOOK_URL and
# DISCORD_FIX_WEBHOOK_URL on the server pointed at the test's own sink,
# see requests-ui.test.mjs's header comment)
DISCORD_FEATURE_WEBHOOK_URL=http://127.0.0.1:4321/feature \
DISCORD_FIX_WEBHOOK_URL=http://127.0.0.1:4321/fix \
npx next start -p 3005 &
node tests/requests-ui.test.mjs                     # or: npm run test:requests-ui

# Unavailable songs: detection, replace, skip-on-play (needs its own server, see below)
node tests/unavailable.test.mjs                     # or: npm run test:unavailable
node tests/unavailable-ui.test.mjs                  # or: npm run test:unavailable-ui

# Trending shelf: starts its own app server from the build (see below)
node tests/trending-ui.test.mjs                     # or: npm run test:trending-ui

# Search in the browser: instant open on a throttled link, the desktop
# dropdown (non-modal: player bar, sidebar and page stay live behind it),
# the row play controls, and the phone's full-screen sheet.
# PB_URL / APP_URL point it at your sandbox.
PB_URL=http://127.0.0.1:8091 APP_URL=http://127.0.0.1:3005 \
node tests/instant-search-ui.test.mjs               # or: npm run test:search-ui

# The full-screen phone player's song title: still when it fits, one smooth
# scroll when it does not, never flickering. PB_URL / APP_URL as above.
PB_URL=http://127.0.0.1:8091 APP_URL=http://127.0.0.1:3005 \
node tests/marquee-ui.test.mjs                      # or: npm run test:marquee-ui

# The phone player bar: one row at the shipped sizes (artwork 56, a 36px
# play disc in a 48px hit box), a name box that scrolls when it overruns, and the safe-area lift that keeps the bar and the
# bottom nav clear of Android's system buttons. PB_URL / APP_URL as above;
# SHOT_DIR, if set, writes a screenshot per width and state into it.
PB_URL=http://127.0.0.1:8091 APP_URL=http://127.0.0.1:3005 \
node tests/mobile-player-ui.test.mjs                # or: npm run test:mobile-player

# The phone bar's shipped sizes on /dizajn (Balanced, a 36px play disc in a
# 48px hit box): measured in the gallery's frames and must equal the numbers
# the section quotes; the old size pickers are gone. Signs in as
# EMBER_EMAIL / EMBER_PASSWORD; writes nothing. SHOT_DIR keeps screenshots.
node tests/phone-bar-sizes-ui.test.mjs              # or: npm run test:phone-bar-sizes

# Screenshots and clips on Report a bug and Send a request: attaches a
# generated PNG and a 2 s webm (made with ffmpeg), checks the thumbnails and
# the total, sends both, and checks the files reached its own Discord sink on
# :8099 as files[n] with their names. The server needs
# DISCORD_BUG_REPORT_WEBHOOK_URL=http://127.0.0.1:8099/bug,
# DISCORD_FEATURE_WEBHOOK_URL=http://127.0.0.1:8099/feature and
# DISCORD_FIX_WEBHOOK_URL=http://127.0.0.1:8099/fix. PB_URL / APP_URL as above.
node tests/attachments-ui.test.mjs                  # or: npm run test:attachments-ui

# Playlist import: Spotify embed source, background jobs, picks (needs its own server, see below)
node tests/import.test.mjs                          # or: npm run test:import
# Playlist import in the browser: Tabs dialog, sidebar ring, restart, 503, review sheet
# (starts its own app on :3034 from the last build, see below)
node tests/import-ui.test.mjs                       # or: npm run test:import-ui
# Transfer: YouTube Music likes after a Google sign-in, against its own fake
# Google on :8097 (the app needs GOOGLE_OAUTH_BASE / YOUTUBE_API_BASE pointed
# there, see the file's header for the whole start line). The fake player's
# `classify` answers from fixtures/imports/ytm-classify.json, so it covers a
# gaming like the first pass drops, likes YouTube Music calls songs, uploads
# the person says yes or no to, and a "Music" Minecraft video left out, none
# of which ever shows in the preview.
node tests/transfer-google-ui.test.mjs

# player.py `match` and `ytplaylist`, no server, no network
.venv/bin/python -m unittest tests/test_player_match.py   # or: npm run test:player-match
# player.py `classify` (YouTube Music's type per liked video), from the
# owner's 16 real likes in fixtures/imports/ytm-get-song-liked16.json
.venv/bin/python -m unittest tests/test_player_classify.py
```

Exit code 0 = everything passed; each check prints PASS/FAIL with detail.

`ai-triage-ui.test.mjs` drives a headless browser: it submits a report as a
throwaway user and checks the diagnosis panel (including the "Reproduce"
line) renders, resets on **Done**, and logs no console errors. Before
submitting, it also fires one deliberately-failing request (a nonexistent
playlist id) so the server log the report picks up has a real error line,
then: via the fake servers' introspection `GET` (see `fake-anthropic.mjs`),
checks the "State when reported" context block and that server error both
reached the AI prompt, and that the context ("Where") and reproduction
("Reproduce") fields both reached the Discord embed.

## What `tabs-text.test.mjs` covers

Pasted text tabs (docs/tab-sources.md, stages 1 to 3), against a running
sandbox (PB_URL, APP_URL; MUSIC_DIR for the on-disk checks):

- **Route**: `POST /api/tabs/text` stores a shared `kind: pasted` row with
  `<stem>.alphatex` and the original `<stem>.txt` side by side; the report
  (strings, tuning, bars, tempo); another member downloads the alphaTex;
  refused signed out, 422 for text with no tab, 413 over 256 KB, 400 for a
  bad tempo.
- **Chain and delete**: `kind=all` lists a file before a pasted tab, the
  default list stays files only; another member cannot delete (403), the
  paster can, and both files go.
- **Tab page**: the pasted tab draws with the "Text tab pasted by" chip and
  its tempo in the header; the playhead line matches the real audio time
  (read through `tests/tabs-measure.mjs`, shared with `tabs-sync.test.mjs`)
  while playing and after a seek from the player bar, and stays in view;
  the tab picker lists the file, then the text tab.
- **Search links**: the empty state's Ultimate Guitar, Guitar Pro files and
  Songsterr chips carry the right URLs and open a new tab with noopener,
  and the ⋯ menu has the same three (never clicked); Generate comes after
  Add a file, marked rough.

## What `tabs-fetch.test.mjs` covers

Tabs Ember finds online (docs/tabs-v3.md stage 3) against `tests/fake-ug.mjs`,
which serves `tests/fixtures/ug` (Ultimate Guitar's page shape with invented
content, built by `tests/fixtures/ug/build.mjs`) and counts every request
(`GET /__calls`). The fake finds only queries containing "ugfetch", so other
suites' songs stay tab-less when the app points at it. The app must run with
`UG_BASE=http://127.0.0.1:4331`; PB_URL, APP_URL, FAKE_UG, and MUSIC_DIR for
the on-disk checks.

- **First opening**: the page says "Finding a tab online"; the server makes one
  search (`artist title`, types 200 and 400, a browser User-Agent) and two tab
  pages: the whole-song tab with the most votes among those rated 4+ (not the
  intro-only one with more votes) and the bass tab. The guitar tab draws with
  the chip "From Ultimate Guitar, not lined up yet", 100 bpm and Drop D from
  the tab; the playhead matches the real audio time (`tests/tabs-measure.mjs`)
  and stays in view; the picker lists both with their ratings, and picking
  the bass tab draws it.
- **Store**: two shared `kind: fetched` rows with no uploader, the page URL,
  UG id, rating, votes and tuning; a `tab_lookups` row saying "found"; the
  alphaTex and the tab text side by side in `MUSIC_DIR/tabs/fetched`.
- **Once per song**: reopening, as the same member and another, sends the
  site nothing. "Search online again" in the ⋯ menu sends one search, fetches
  no page it already has, and says "Nothing new found online."
- **Nothing online**: a song the fake does not know falls back to the empty
  state and is searched once only, across a reload.

The unit side (vitest): `lib/tabFetch/ug.test.ts` (search and tab page
parsing from the fixtures, what is skipped, ranking, song matching, marks,
tuning, alphaTex through AlphaTab), `lib/tabFetch/polite.test.ts` (the
2 s queue per site, a browser User-Agent, an hour's backoff on 429, 403 and
503), `lib/tabFetch/online.test.ts` (rows, files, the once-per-song lookup,
two openings sharing one search, "again", "none", a page with no notes, a
missing page, 429/403 and block pages staying quiet, the store order and
labels) and `app/api/tabs/tabs-online-route.test.ts` (the route with a fake
site on `UG_BASE`).

`tabs-ui.test.mjs` also has a **nothing overflows** section (docs/tabs-v3.md
section 5): a long song name, a member with a 60-character name, a file with
six long-named tracks and seven pasted tabs, at 390, 1280 and 1920 wide. Title,
meta line, chip and toolbar row, every ⋯ menu item and all eight picker lines
end inside the window, every picker line keeps its whole text as a tooltip,
and `document.documentElement.scrollWidth` never exceeds the window.

## What `ai-triage.test.mjs` covers

Bug reports get read by Claude before landing in Discord (SETUP.md → "Bug
reports → your Discord channel"). The file opens with unit-level checks
(no sandbox, no network) run directly against `lib/ai/triage.ts`'s real
source via `ts-stub-loader.mjs`:

- **`buildDigest`**: the "State when reported" context block is present,
  renders one line per field, and omits empty ones; a native (`native:*`)
  entry is included; a client "api" error and the matching server entry
  (same reqId) both render a `{req XXXXXXXX}` tag and the id isn't
  duplicated into the JSON data dump; the desktop log tail is capped at 60
  lines; and, when the digest is forced over its char budget, entries trim
  oldest-first (client before server) while the context block and the
  newest entries on each side survive.
- **`TriageSchema`**: `reproduction` defaults to `"unknown"` when absent or
  empty, and passes through otherwise.

Then it stands up a fake Anthropic API and a fake Discord webhook and drives
the real route end to end:

- **Happy path**: triage (including `reproduction`) reaches both the
  reporter and the Discord embed; the right model, key header and API
  version go out; the context block and a `native:*` entry reach the
  prompt; the context ("Where") and reproduction ("Reproduce") fields reach
  the Discord embed.
- **Digest quality**: 341 events condense to a bounded prompt, a repeated
  error collapses to `(xN)`, a rare error buried in noise still survives, and
  30 genuinely distinct errors are all preserved.
- **Failure modes**: Anthropic returning 500, prose instead of JSON, or JSON
  missing required fields. In every case the report must still reach Discord
  with `triage: null`. **Triage must never be able to eat a bug report.**
- **No API key**: the default for anyone self-hosting: Anthropic is never
  called and the report sends exactly as before.
- **Rate limit**: one report per user per 30s, unchanged.
- **Automatic reports** (series H): accepted, titled "Automatic report from
  `<email>`", marked in the footer, triaged with the cheaper model, and
  rate-limited in their own 3/hour bucket that leaves the 30s manual cooldown
  alone.
- **Daily error digest** (series I): two different routes are driven into a
  429 so the server log holds two distinct errors, then
  `POST /api/admin/digest` is called as an admin (and refused as a member).
  The fake webhook must receive one message titled "Daily error digest
  `<date>`" carrying both fingerprints, a grouped code block and the
  `digest.json` attachment; running the trigger twice must post twice, since
  the manual path deliberately writes no day marker.

> The suite creates `bugtestadmin@ember.test` (an admin) alongside the
> numbered `bugtest<N>@ember.test` members, since the digest trigger is
> admin-only.

The scheduled digest and the manual trigger both stay off unless
`DIGEST_ENABLED=1` (the manual trigger used to ignore the flag; a final-review
fix gated it too, since otherwise a self-hosted admin with no webhook of
their own could repeatedly post their host's errors into the webhook baked
into the app). The test server this suite runs against sets `DIGEST_ENABLED=1`
so the manual trigger works; the scheduler still never fires on its own,
since that only happens at the top of the hour via instrumentation.ts.

## What `uploads.test.mjs` covers

Members can upload their own songs (SETUP.md → "Custom song uploads"). The
test uploads a real generated WAV and checks the whole loop:

- **Shared library**: a *different* member sees the upload in the list, finds
  it in search (ranked above YouTube), and can stream it. Signed-out callers
  get nothing from either.
- **Streaming**: bytes come back byte-identical, with working Range requests
  (206, correct `Content-Range`) and 416 for an impossible range.
- **Validation**: a text file renamed `.mp3` with an audio MIME type is
  rejected on its bytes; oversize and empty files are rejected; a missing
  title falls back to the filename.
- **Path traversal**: a forged record whose filename escapes the uploads
  directory must 404, not serve `/etc/passwd`.
- **Ownership**: only the uploader can delete; the file leaves disk with the
  record; the stream then 404s.
- **Cleanup**: the 14-day sweep must count uploads as protected. Regression
  guard: an unplayed upload row survives a real (non-dry-run) cleanup.
- **Rate limit**: upload spam is blocked.

`uploads-ui.test.mjs` drives the browser: filename pre-fills title/artist,
duration is read client-side, the song appears in the Uploads tab, and
double-clicking it actually plays (audio element advances past zero with no
error).

## What `privacy.test.mjs` covers

Two independent switches (Settings → Profile → Privacy): Discord rich
presence, and appearing in "Friends are listening to".

- **Defaults to sharing**: the flags are stored inverted (`hide_*`) so
  existing users don't silently vanish the day this ships.
- **Server-side enforcement**: a hidden user is absent from the
  `/api/listening` *response*, not merely unrendered. A UI-only hide would
  still leak them to anyone reading the network tab.
- **Independence**: turning one off leaves the other alone. A single shared
  flag would be a quiet privacy bug.
- **No resurrection**: a fresh play doesn't bring a hidden user back.
- **Discord**: the server refuses to broadcast for an opted-out user, resumes
  when re-enabled, and treats a session-less caller as opted out.
- **Per-user**: one person hiding doesn't affect anyone else.

The UI itself (both switches render, flipping one persists across a reload and
leaves the other alone) was verified in a headless browser against the same
sandbox.

## What `changelog-ui.test.mjs` covers

The "What's new" page and its New tags (docs/changelog-system.md), in a
headless browser. Each run creates and invites a fresh `@ember.test` user,
signs in through the form, and deletes both at the end. It sets the user's
seen version directly through the PocketBase admin API to stand in for "a
release came out since you last looked".

- **A brand new user sees nothing as New**: the first load writes the current
  app version (read from `apps/web/package.json`) and the sidebar row has no
  tag.
- **An older seen version shows the tag**: the pill appears at the right edge
  of the sidebar row at 1440 wide, it pulses, and the pulse stops under
  `prefers-reduced-motion`.
- **Phone, 390 wide**: the menu button has the dot, the drawer has the row
  with the tag, and the row opens the page.
- **The page**: every entry above the seen version is tagged, opening the page
  does not mark anything read, and Mark all as read clears the page and the
  sidebar, saves the version, survives a reload, and clears the phone dot too.
- **The hide switch**: removes every tag without marking anything read,
  survives a reload, hides the phone dot, and turning it off brings the tags
  back.
- No uncaught page errors along the way.

The same behaviour is unit tested without a browser in
`apps/web/lib/{semver,changelog,changelog-new}.test.ts`,
`stores/useChangelogStore.test.ts`, `app/api/changelog/route.test.ts`,
`components/changelog/*.test.tsx`, `components/nav/ChangelogBadge.test.tsx`
and `app/(app)/whats-new/page.test.tsx`.

## What `desktop-update.test.mjs` covers

The desktop auto-update feed (SETUP.md → "Desktop auto-update"). It stands up
a **fake GitHub API**, so it needs no token, no network, and never touches the
real release. Run a third sandbox server for it:

```bash
GITHUB_RELEASES_TOKEN=test-token GITHUB_API_BASE=http://127.0.0.1:4321 \
UPDATE_CACHE_MS=0 npx next start -p 3007 &
```

(`UPDATE_CACHE_MS=0` disables the 5-minute cache that production uses ,
otherwise a warm result hides the failure paths.)

- **The right asset per platform**: macOS updates from the `.app.tar.gz`, NOT
  the `.dmg` a human downloads; Windows the NSIS installer; Linux the AppImage.
- **Signature included**: Tauri verifies it against the pubkey compiled into
  the app, so a release with no `.sig` must yield NO update rather than an
  unverifiable one.
- **Downloads route through this server**, never GitHub directly: that's what
  keeps the token on the host and the repo private.
- **204 means up to date**, and every failure degrades to it: GitHub down,
  draft-only releases, same or newer client version, unknown platform. A broken
  update check must never interrupt playback.
- **The asset proxy** streams bytes with the token attached server-side, and
  rejects a non-numeric or unknown asset id.
- **No session needed**: the updater runs in Rust and has no cookies.

## What `stream-source.test.mjs` covers

The rule it locks in: **the downloaded file is the source of truth.** A song is
fetched once with yt-dlp and served off disk forever after, so playback never
depends on a signed googlevideo URL staying valid: which is what produced the
403s, worst of all in the native apps.

It uses `tests/fake-player.sh` in place of player.py, so there's no yt-dlp and
no network. Its own server:

```bash
STREAM_MODE= PYTHON_BIN=/bin/bash \
PLAYER_SCRIPT="$PWD/tests/fake-player.sh" \
MUSIC_DIR=/tmp/ember-stream-test/music \
FAKE_PLAYER_LOG=/tmp/ember-stream-test/calls.log \
STREAM_CACHE_WARM=0 npx next start -p 3008 &
```

`STREAM_MODE=` (empty) matters: it clears any value in your own `.env.local`
so the test measures the DEFAULT, not your local preference.

- **A fresh song downloads, then plays from the file**: and the server never
  resolves a live stream URL at all, so there's no 403 surface.
- **Replaying it touches yt-dlp zero times.**
- **Four simultaneous requests for one uncached song spawn ONE download** ,
  the native players open several byte-range connections per song, which
  without deduping means several yt-dlp runs racing to write the same file.
- **Range requests still work** (206 alongside the 200s).
- **The audio really is on disk** in MUSIC_DIR afterwards.

## What `stream-fallback.test.mjs` covers

A real incident: the host's yt-dlp went stale, YouTube began 403ing its
**downloader** while URL resolution kept working, and because downloads are the
primary source the app stopped playing anything uncached. Silence, no clue why.

With a fake player rigged to fail downloads (`FAKE_FAIL_DOWNLOAD=1`) and a
local stand-in for googlevideo:

- **A failed download falls through to live streaming** rather than failing the
  play, and the bytes really come from the live URL.
- The order is right: download attempted FIRST, live resolution only after.
- **An explicit `?download=1` still fails loudly**: that request asked for a
  file on disk, and quietly proxying instead would be a lie.

The fix for the underlying cause is keeping yt-dlp current, which `update.sh`
now does on every host update.

## What `stream-range.test.mjs` covers

The other half of the stale-yt-dlp story: what the same host does with a
**Range** request. A Range request is not an edge case. The desktop engine
sends one whenever its stream drops a chunk (stream-download refills the gap),
and every browser sends one to seek.

Same setup as `stream-fallback.test.mjs`, plus a googlevideo stand-in that
answers a plain GET but **403s anything with a Range header**, the way a signed
URL behaves once it no longer matches the client that resolved it:

- **The first play still works** through the live proxy.
- **(bug) The mid-file Range request comes back 502 JSON**, after the route has
  run its whole download -> 403 -> re-extract -> 403 cascade. To the desktop
  engine that is a dead source: rodio reports end-of-source, the engine emits
  `audio:ended`, and the player starts the NEXT song part-way through this one.
  The Rust half of that is
  `apps/desktop/src-tauri/src/audio/skip_repro.rs`.
- **A cached track answers 206 with the right bytes**, which is why the fault
  only touches tracks the stale yt-dlp could not cache.

## What `stream-fastfail.test.mjs` covers

The third part of the same story, and the one the field reports were about: a
song the host cannot produce at all must FAIL, quickly. It used to freeze the
app instead, for 25 seconds ("timed out decoding the track after 25s", twice in
real reports, ten times in one week), because the request either ran a second
whole yt-dlp round before answering or never answered at all, and a player
cannot tell a server that is still working from one that never will.

Unlike the two above it starts **its own** app server (`APP_PORT`, default
3038) from the existing build in `apps/web`, with `FAKE_FAIL_DOWNLOAD=1` and a
fake googlevideo on `ORIGIN_PORT` (default 4462) whose behaviour it switches
between checks. No PocketBase needed. What it measures is time to an answer:

- **F1**: the fallback that works still works (a failed download is still
  served live).
- **F2/F3**: with the live stream refused too, the play answers **502 with a
  readable sentence in well under a second**, having asked yt-dlp **once**.
  Before: `download, info, info, download` , two extraction runs and two
  downloads, tens of seconds on a real host, for an answer it already had.
- **F4**: an upstream that accepts the connection and never answers is given up
  on at the headers budget (6s) instead of never (`fetch` has no read timeout
  in Node, so the old route simply never replied).
- **F5**: a body that stops mid-transfer **breaks** at the stall budget (10s)
  instead of leaving the client holding an open 200 forever. That shape is what
  produced the 25s freeze.
- **F6**: a slow but PROGRESSING stream is delivered in full , the guard
  against turning a hang fix into a "your connection is too slow" bug.
- **F7**: nothing listening upstream at all is a clear 502, not a bare 500
  saying "fetch failed".

The engine's half of the same fault (one flat 25s budget over connect, buffer
and decode, so every dead source cost the lot) is
`apps/desktop/src-tauri/src/audio/fastfail.rs`, run by `cargo test --lib` in
`apps/desktop/src-tauri`: it drives the real `open_source` against a host that
stalls, refuses, or delivers slowly, and keeps the old flat-budget shape in one
test as the measurement of what it used to cost. What the listener is told, and
the rule that web audio is only tried when it could actually help, are unit
tests: `components/player/PlayerProvider.fastfail.test.tsx`,
`lib/playback/tauriBackend.test.ts`, `hooks/player/useAvailabilityProbe.test.ts`
and `lib/streamGuard.test.ts`.

## What `desktop-logger.test.mjs` covers

Needs **no sandbox and no Tauri**: it extracts the injected logger script
straight out of `lib.rs` and runs it against a fake webview, in milliseconds.

The incident: `invoke()` returns a promise, and a rejected one ("Command
log_event not allowed by ACL") fired `unhandledrejection`, which the logger
logged, which invoked again. The loop filled the 200-entry buffer with one
repeated error, so a real bug report arrived containing 400 copies of it and
nothing else: the actual problem was invisible.

- A refused invoke raises **no unhandled rejection**.
- Fifty identical errors send at most once: no flooding the buffer.
- An error raised *by the logging path itself* doesn't re-enter it.
- Genuinely different messages still all get through.

## What `authorization.test.mjs` covers

Invite-only is not the same as trusting every member with everyone else's
library. Two fresh users per run, exercising what one could reach of the
other's:

- Someone else's playlist can't be read, added to, deleted, or have tracks
  removed: and the refusal must be a sentence, not the store's raw
  "Failed to create record." (that 400 also masked *whether* the check ran).
- After a refused write, the owner's playlist is verified UNCHANGED: status
  codes alone don't prove nothing happened.
- Likes and history stay per-user.
- Every admin route (users, tracks, invites, cleanup, digest) refuses a normal
  member.
- Signed-out callers get nothing.

## What `library-collections-ui.test.mjs` covers

The rewritten `/library` page (shelves, not tabs) and the three collection
routes it links to. Uses the same fake `EmberOffline` plugin as
`offline-android-ui.test.mjs`, so `__emberOfflineCalls` matches between them.

- `/library` shows "Your collections" and "Playlists" shelves, no tablist.
- The sidebar lists Liked songs, Recently played and Uploads above the
  playlist links.
- The Liked page has Play and Shuffle play buttons, a Download for offline
  button, and downloading it pins `liked`.
- The Uploads page has an Upload button, a Download for offline button, and
  downloading it pins `uploads`.
- The Recently played page is read-only (no Remove buttons), has a Download
  for offline button, and downloading it pins `recent`.
- The offline `/library` view lists pinned collections by name, straight from
  the offline index.
- A browser without the native offline plugin shows no Download button on a
  collection page.
- No page errors in either browser context.

## What `offline-android-ui.test.mjs` and `offline-page.test.mjs` cover

The two halves of offline on Android, both against a fake `EmberOffline`
plugin so they run in a desktop browser: `offline-android-ui` drives the real
app (needs the server), `offline-page` loads the bundled cold-start page
`apps/mobile/public/offline.html` straight off disk (needs nothing).

- Downloaded tracks play from the local file, and the player bar shows the
  downloaded artwork rather than the remote `artworkUrl`.
- Settings, Downloads shows `n failed` with the reason in words, and its Retry
  calls the plugin's `retry({ id })` with the pin id: no track list from the
  query cache.
- The cold-start page lists each pin's downloaded tracks with their local
  artwork, plays them, and steps through them.
- The lock screen is handed the artwork inline as a `data:` URL, not as the
  `_capacitor_file_` path: the native media-session plugin fetches artwork
  over HTTP and cannot resolve that path (see apps/mobile/README.md). A track
  with no local art sends no artwork entry at all, and a read that lands after
  the user has skipped on is dropped instead of overwriting the new track.
- `offline-page` also guards the page's size and its no-em-dashes rule: it is
  bundled into the APK, so it has to stay one small file.

Not covered here, because no browser can fake it: whether the native side
actually writes the files, what the real lock screen shows, and what happens
with the radio off. That is the emulator pass in apps/mobile/README.md's
"Emulator recipe".

## What `unavailable.test.mjs` and `unavailable-ui.test.mjs` cover

A YouTube video that's genuinely gone (removed by the uploader, made
private, taken down, region-locked, the channel terminated) gets flagged
unavailable: its row greys out with an "Unavailable" badge, its own Play
button disables, and a "Find replacement" button opens a dialog of fresh
candidates to swap in. The rule that makes this safe: only a DEFINITIVE
yt-dlp message marks a track dead. A 403, a bot-check prompt, a timeout, or
anything else transient must never be mistaken for removed, since that would
permanently hide a song that plays fine again a minute later.

`tests/fake-player.sh` drives this without real yt-dlp or network access.
Two env vars pick the failure per video id, both re-read on every call so a
test can restore a video mid-run just by editing the file:

- `FAKE_UNAVAILABLE_FILE`: ids listed here fail with a message the detector
  reads as definitive ("Video unavailable... removed by the uploader").
- `FAKE_TRANSIENT_FILE`: ids listed here fail with a 403 / bot-check message
  instead, the kind that must NOT flag the track.

Its own server (this worktree's sandbox: PocketBase on `:8092`, the app on
`:3011`; use whatever spare pair is actually free in yours):

```bash
SB=/tmp/ember-unavailable-test && mkdir -p "$SB/music"
: > "$SB/unavailable.txt" && : > "$SB/transient.txt"

cd apps/web && POCKETBASE_URL=http://127.0.0.1:8092 STREAM_MODE= PYTHON_BIN=/bin/bash \
PLAYER_SCRIPT="$PWD/../../tests/fake-player.sh" MUSIC_DIR="$SB/music" FAKE_PLAYER_LOG="$SB/calls.log" \
FAKE_UNAVAILABLE_FILE="$SB/unavailable.txt" FAKE_TRANSIENT_FILE="$SB/transient.txt" STREAM_CACHE_WARM=0 \
POCKETBASE_ADMIN_EMAIL=admin@ember.com POCKETBASE_ADMIN_PASSWORD=egKa5WNMx3QpuG7 npx next start -p 3011 &
```

Then:

```bash
PB_URL=http://127.0.0.1:8092 APP_URL=http://127.0.0.1:3011 SB="$SB" node tests/unavailable.test.mjs      # or: npm run test:unavailable
PB_URL=http://127.0.0.1:8092 APP_URL=http://127.0.0.1:3011 SB="$SB" node tests/unavailable-ui.test.mjs   # or: npm run test:unavailable-ui
```

`unavailable.test.mjs` (42 checks): detection (a definitive failure answers
410 with a clean reason, never a Python traceback), the flag carried on
playlists and likes, a transient 403 never flagging anything, the flag
clearing once a track plays again, the replacements/availability endpoints,
replace-in-playlist (including merging into an already-present track and
refusing another user's edit), and unavailable tracks excluded from
recommended radio. It's safe to rerun against a reused sandbox: it clears any
flag left over from a previous run, through the real clear-on-play path
rather than a raw PocketBase patch, before seeding its own state.

The pure skip-over-unavailable rules (`isUnavailable`, `nextPlayable`) are
unit-tested in `apps/web/lib/playback/queueNav.test.ts`, run by
`npm run test:unit`: they used to have their own `tests/skip-unavailable.test.mjs`
runner, which the deslop merge folded into that suite.

`unavailable-ui.test.mjs` (22 checks) drives a real browser against the same
server: the flagged row's badge and disabled Play button (U1), the
playlist's big Play button skipping the dead first track with a "Skipped"
toast and landing on the live one instead (U2), the Find Replacement dialog
swapping a track end to end, checked both in the DOM and with a follow-up
`GET /api/playlists/<id>` (U3), and no console errors beyond the fake audio
bytes' expected decode failures (U4).

## What `instant-search-ui.test.mjs` covers

Search in a real Chromium tab against the sandbox (`PB_URL`, `APP_URL`), 69
checks in three parts.

First, the bug it was written for: with the shell already loaded and the
connection throttled to ~1kbps and 1.5 s latency, clicking Search shows the
results panel and a focused box well inside one round trip, typing lands at
once, the sidebar never disappears, and Escape and a click outside both
dismiss it with no page errors from the two paths racing.

Then the row play controls: every result and recent-search row has a
play/pause button naming its song, pressing one starts it for real (a real
stream, not a mocked flag), the same button pauses and resumes, another
row's button takes over, the playing row's title is the only one in the
ember accent, nothing overflows, and a row's button is reachable by Tab.

Then the desktop dropdown's own promise, at 1280 and 1440: it draws no
backdrop, marks nothing on screen `aria-modal`, and sits inside no dialog;
it fits the window and stops above the player bar, scrolling inside itself;
pressing a row's play starts the song and leaves the panel open with its
ember title; the player bar's play/pause is the topmost thing at its own
position and a press both works and closes the panel (a press outside is
the close); the sidebar is likewise unblocked, and clicking it navigates,
which closes the panel; Escape closes it and takes focus out of the box;
"/" reopens it with the caret in the box (and is not typed into it); and
the arrow keys walk the rows and come back to the box. Finally, at 390, the
phone still gets the modal full-screen sheet with its backdrop and its
close button, inside the viewport, closing on Escape.

## What `marquee-ui.test.mjs` covers

The song title in the full-screen phone player (`components/player/
MarqueeText.tsx`), in a real Chromium tab at 390x844 with touch, 12 checks.

The bug it was written for: the title "flickered and was mumbled". A
design-system spacing token, `--spacing-block`, completes one of Tailwind
4's own utility names, so it generated a second
`.inline-block { inline-size: 1rem }` rule, emitted after the core
`display: inline-block` one at the same specificity. Every `inline-block`
element in the app was pinned to 16px wide, and the marquee's two copies of
the title became two 16px boxes with the whole title spilling out of each,
sliding over one another.

It seeds one long and one short upload, opens the full-screen view on each
and samples the title element every 100 ms for three seconds. A long title:
its box never moves or resizes (a measure/render loop would show here), the
number of rendered copies never changes (the animated/static flip would
show here), both copies keep one identical width wider than the box (the
squashing above would show here), the marquee animation runs throughout,
the title holds still through its start delay and is moving by the end. A
short title: one copy, no animation, not a pixel of movement. Plus no
uncaught page errors.

The threshold itself, where a title is within a pixel or two of the edge of
its box, is covered by unit tests instead
(`apps/web/components/player/MarqueeText.test.tsx`), and the token collision
by `apps/web/lib/themeCollisions.test.ts`, which fails if a `--spacing-*`
token shadows a core display utility without globals.css putting the stolen
property back.

## What `mobile-player-ui.test.mjs` covers

The phone player bar (`apps/web/components/player/PhonePlayerBar.tsx`) in a
real Chromium tab with touch, at 390x844 and again at 360x740: 49 checks.

What it was written for: on a phone the bar gave the song name a 38px box
(the old [1fr auto 1fr] row, most of the left column eaten by the artwork),
its buttons were 32 to 40px, and both the bar and the bottom nav sat UNDER
Android's back, home and recents buttons. The last of those is half a native
bug: the app targets SDK 35, where the system draws itself over the WebView,
and the WebView reports nothing through `env(safe-area-inset-bottom)`, so
`MainActivity` publishes the real window insets to the page as
`--ember-inset-*` (see `apps/mobile/android/.../SafeAreaInsets.kt`).

It seeds one long and one short upload, plays each, and measures the live
bar: the name row sits above the control row, the name box is at least
300px (358 at 390, 328 at 360) and is the full width of the bar, previous,
next, queue and the artwork are each at least 48x48 and play at least 56x56,
and nothing overflows the viewport horizontally. A long name is drawn as two
copies with the marquee animation running and is actually moving a second
later; a short name is one copy, no animation, not a pixel of movement.

Then the inset, published the way the phone publishes it
(`--ember-inset-bottom` on `<html>`, which globals.css folds into
`--safe-bottom`): with none, the bar and the nav have 0 padding and the nav
reaches the bottom of the viewport; with 48px, both carry exactly 48px, the
nav grows by exactly 48px so its buttons move up, the control row ends above
where the system buttons would start, and no tap target shrank to pay for
it. Plus no uncaught page errors.

Last, the native script itself: the literal JavaScript `MainActivity`
injects for a 48dp navigation bar is run in the page, and the bar and the
nav are checked to lift by 48px. `SafeAreaInsetsTest` asserts the Kotlin
produces byte-for-byte that string, so the two halves cannot drift.

The rest of the Android half is covered by JVM unit tests
(`apps/mobile/android/app/src/test/java/app/ember/music/SafeAreaInsetsTest.kt`,
`./gradlew testDebugUnitTest`), and the single source of truth for the inset
by `apps/web/lib/lintRules.test.ts`.

## What `trending-ui.test.mjs` and `test_player_trending.py` cover

Home's "Trending right now" shelf is YouTube Music's daily chart
(docs/trending.md). `tests/fake-player.sh` answers `trending` with a fixed
12-song chart ("Chart Song 01" by "Chart Artist 01" is number 1), and
`FAKE_FAIL_TRENDING=1` makes it fail the way player.py does when every chart
source is down.

`trending-ui.test.mjs` (8 checks) needs only a sandbox PocketBase and a build
made against it; it starts and stops its own app server (port `APP_PORT`,
default 3029) with the fake player and a fresh `MUSIC_DIR`, so the chart
cache starts cold:

```bash
cd apps/web && POCKETBASE_URL=http://127.0.0.1:8096 npx next build --webpack && cd ../..
PB_URL=http://127.0.0.1:8096 APP_PORT=3029 node tests/trending-ui.test.mjs   # or: npm run test:trending-ui
```

It checks the shelf shows the chart in rank order (T1); the API and the
search empty state answer the same order, fresh, mirrored to
`MUSIC_DIR/trending.json` (T2); then it ages that file to 13 h, restarts the
server with `FAKE_FAIL_TRENDING=1`, and checks the shelf still shows the last
good list while the API marks it `stale` with the old `fetchedAt` (T3), and
that the server asked the failing source exactly once (T4).

The cache rules themselves (TTL, stale-while-revalidate, one refresh in
flight, cold start, country validation) are unit tests in
`apps/web/lib/trending.test.ts`. The player side, picking the chart playlist
out of `get_charts` and the yt-dlp fallback, is a Python unittest against
saved ytmusicapi output in `tests/fixtures/trending/`, no network:

```bash
.venv/bin/python -m unittest tests/test_player_trending.py   # or: npm run test:trending-py
```

## What `import.test.mjs`, `import-ui.test.mjs` and `test_player_match.py` cover

Playlist import, stages 1 to 4 of docs/imports.md. Nothing reaches the
internet: `tests/fake-spotify.mjs` serves the saved Spotify embed pages and
oEmbed answers from `tests/fixtures/imports/`, and `tests/fake-player.sh`
answers `match` from `tests/fixtures/imports/ytm-candidates.json` (keyed by
the search string, `title-only:<title>` for the retry) and `ytplaylist` from
`tests/fixtures/imports/ytm-playlists.json`. The app finds the fake through
`SPOTIFY_EMBED_BASE`.

Its own server (this worktree's sandbox: PocketBase on `:8094`, the app on
`:3034`); the test starts the fake Spotify on `:4331` itself:

```bash
SB=/tmp/ember-import-test && mkdir -p "$SB/music"
cd apps/web && POCKETBASE_URL=http://127.0.0.1:8094 \
  SPOTIFY_EMBED_BASE=http://127.0.0.1:4331 \
  PYTHON_BIN=/bin/bash PLAYER_SCRIPT="$PWD/../../tests/fake-player.sh" \
  FAKE_PLAYER_LOG="$SB/calls.log" MUSIC_DIR="$SB/music" \
  POCKETBASE_ADMIN_EMAIL=admin@ember.com POCKETBASE_ADMIN_PASSWORD=egKa5WNMx3QpuG7 \
  DISCORD_BUG_REPORT_WEBHOOK_URL=http://127.0.0.1:4312/hook \
  npx next start -p 3034 &
cd ../.. && PB_URL=http://127.0.0.1:8094 APP_URL=http://127.0.0.1:3034 node tests/import.test.mjs
# Stop that server before import-ui.test.mjs, which starts its own on :3034.
```

PocketBase needs `ensure_imports.pb.js` loaded (restart it once after
pulling), and the server needs the admin credentials: the import runner and
the job routes write with the admin client.

- **Spotify inspect** (A): a playlist link reads all 50 tracks of the saved
  page in source order, with title, artists (a multi-artist line split),
  length, explicit flag and uri; the name and cover come from oEmbed; a
  100-track playlist is flagged as possibly longer.
- **Errors people can act on** (B): an unknown or private playlist is a 404
  that says to make it public; a changed page shape is a 502 that says so; an
  album link is a 400.
- **A background job** (C): `POST /api/import/jobs` creates the playlist and
  a queued job; the server's runner matches all 50 tracks and splits them
  into accepted (4), needs review (2: a live version, a fan upload by someone
  else) and not found (44), with the job's counts agreeing. Every item keeps
  its source row and every candidate with a score and reasons; a remix is
  kept but scored down; official audio beats the music video; a track the
  first search misses is found by the title-only retry; only accepted tracks
  are in the playlist, in source order. Signed out never starts one, someone
  else can neither read nor settle it, a pick lands at its source position,
  only a YouTube song can be picked, Remove song updates the counts, and a
  finished import cannot be stopped.
- **YouTube Music** (D): a public playlist inspects to ready tracks; private
  and unknown playlists get their own messages; an import adds the
  playlist's own tracks with nothing to review.
- **Rate limit** (E): the sixth start within ten minutes is a 429.

`import-ui.test.mjs` drives Chromium (playwright-core) against an app it
starts itself on `:3034` (from `apps/web`'s last `next build`, pointed at
PocketBase on `:8094`, the fake Spotify and `fake-player.sh` with
`FAKE_MATCH_SECONDS=0.5`, `IMPORT_STALE_MS=3000` and a `FAKE_503_ONCE` flag
file), because it has to stop and restart it mid-import. Nothing else may be
listening on `:3034`. Checks: the library's old Import button is gone (U1);
"+" opens New playlist with the Start empty / Import from a link tabs, a
pasted link previews, Create closes the dialog and opens the playlist
(U2 to U5); the sidebar row's ring counts up with "N of 50" and the page shows
the progress banner (U6, U7); the server is killed mid-import and restarted,
and the job resumes from its cursor (U8, U9); the one-off 503 pauses it with a
retry time, then it continues (U10); the playlist filled in source order and
the Done summary counts match the job, with "2 to review" in the sidebar
(U11 to U14); Review opens the right-side sheet, key 2 puts the second
candidate in at its source position, S skips (U15 to U20); "Wrong song?
Re-match" from a track's More menu swaps it in place (U21, U22); no page
errors (U23).

`fake-player.sh` knobs for these: `FAKE_503_ONCE=<file>` fails the next
`match` call like a rate-limited YouTube Music search while the file exists
(and deletes it, so exactly one call fails); `FAKE_MATCH_SECONDS` slows every
`match` call.

`test_player_match.py` runs `player.py match` against saved ytmusicapi
search output (`ytm-search-bass-persuades.json`) with YTMusic mocked:
five candidates in search order with title, artists, length, video type and
explicit flag, unscored; the two query forms (`"title artist"`, then the
title alone with `ignore_spelling`); one list per query even when a search
fails, with the failed indexes listed separately (`failed`) so the runner
retries the batch instead of calling those songs not found. It also checks
`ytplaylist` falling back to yt-dlp when ytmusicapi fails, and reporting
`private` when both fail. Run it with the repo's venv.

## What `transfer-google-ui.test.mjs` covers

The YouTube Music likes transfer end to end in Chromium, with no Google
account: the test serves its own fake Google on `FAKE_GOOGLE_PORT` (8097):
`/oauth/device/code`, `/oauth/token`, `/oauth/revoke`, a `/device` page with
a code box and Allow / Deny, and `/youtube/v3/videos?myRating=like` (two
pages: two songs, a gaming video, a Topic-channel song). The app is started
with `GOOGLE_OAUTH_BASE=http://127.0.0.1:8097/oauth`,
`YOUTUBE_API_BASE=http://127.0.0.1:8097/youtube/v3`, a fake client id and
secret, and the fake player.

- **A**: Liked songs, YouTube Music offers "I can sign in to my Google
  account" first; the steps name google.com/device; no F12 or headers.
- **B**: Sign in with Google shows the code, a link to the verification URL
  in a new tab, and the waiting line.
- **C**: the test opens that link, types the code on the fake page and
  presses Allow; the preview shows 3 songs, the cleaned-up title, "Left out
  1 like that is not music", and the fake saw the refresh token revoked
  right after the two pages were read with the Bearer token.
- **D**: Transfer 3 songs lands on Liked songs with all three and without
  the gaming video.
- **E**: Deny on the fake page shows "You said no on Google's page, so
  nothing was read." and revokes nothing (there was no token).
- **F**: closing the dialog mid-sign-in stops the server polling Google.
- **G**: no response the browser received, no console line and nothing in
  `EMBER_LOG_DIR` holds a token, device code or the client secret.
