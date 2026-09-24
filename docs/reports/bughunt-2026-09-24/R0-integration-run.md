# R0. Integration run of the merged bughunt branch

**What was run:** every `tests/*.mjs` suite that runs against a sandbox, plus `tests/watchdog.test.sh` and the `tests/test_*.py` unittests, against a real `next build --webpack` of `bughunt` at `3d1a2db` (plus the fixes below). A fresh throwaway PocketBase on 8089 (this branch's hooks and migrations, `migrate up` first, `--automigrate=0`), superuser and owner account from `EMBER_PB_SUPERUSER_*` / `EMBER_ADMIN_*`, the app on 3051. Every Discord webhook (bug, crash, feature, fix) pointed at a local sink; the fake Anthropic, fake Songsterr/UG, fake Spotify, fake Google, fake GitHub and `tests/fake-player.sh` stood in for everything external. Suites that need a server config of their own (fake player, 1 MB upload cap, sinks on 8099, fake GitHub, no API key) got the app on 3051 restarted with that config; suites that start their own app were given `APP_PORT=3051`, and `pb-hooks-credentials` was given `PB_PORT=8089` after the sandbox PocketBase was stopped.

**Result:** 1 regression from tonight found and fixed, 5 tests updated for behaviour changed on purpose, 6 failures that were already there before tonight. Everything else passes. `npx vitest run` in `apps/web`: 2861 passed (2858 before plus the 3 new ones).

## Suites

"First run" is the first run on this build; "after" is after the fixes and test updates below. "Before tonight" is only filled in where it was checked against `test-all` (the branch the bughunt fixes were merged into).

| Suite | First run | After | Before tonight | Notes |
|---|---|---|---|---|
| access-control-ui | 21/22 | 22/22 | | W01d updated (W05) |
| ai-triage | 87/90 | 90/90 | | E1 to E4 need a no-key server; run again against 3051 restarted without a key, with a fresh user (the same process shares the 30 s limit): all pass |
| ai-triage-ui | 25/25 | 25/25 | | |
| android-player-ui | 12/12 | 12/12 | | |
| attachments-ui | 38/38 | 38/38 | | sinks on 8099 |
| authorization | 17/17 | 17/17 | | |
| changelog-ui | 28/28 | 28/28 | | |
| collections | crash | crash | same crash | (c) `lib/collections.ts` imports `./format` with no extension; Node cannot load it |
| crash-report | 33/34 | 33/34 | 33/34 | (c) the default webhook moved out of the bug-report route, so "the real route file still has an extractable default" fails |
| desktop-logger | 5/5 | 5/5 | | |
| desktop-update | 19/19 | 19/19 | | fake GitHub |
| ffmpeg-resolve | 8/9 | 8/9 | 8/9 | (c) `test_ffmpeg_path.py`: `player.py` has 6 `_cookie_opts()` and 4 `_ffmpeg_opts()`, same on test-all |
| import | 39/39 | 39/39 | | |
| import-ui | 24/24 | 24/24 | | starts its own app |
| instant-search-ui | 77/77 | 77/77 | | a few real YouTube searches and plays |
| layout-w09-admin-users | 5/6 | 5/6 | | (c) see below |
| layout-w10-playlist-header | no run | 7/7 | | needed a long-named playlist seeded for the owner account |
| layout-w11-settings-tabs | 5/5 | 5/5 | | |
| library-collections-ui | 41/41 | 41/41 | | |
| likes-order | 5/5 | 5/5 | | |
| marquee-ui | 12/12 | 12/12 | | |
| mobile-player-ui | 101/101 | 101/101 | | |
| offline-android-ui | 20/20 | 20/20 | | |
| offline-page | 35/35 | 35/35 | | |
| offline-web-ui | 5/5 | 5/5 | | |
| pb-admin-exposure | 25/26 | 26/26 | | B4 updated (W03) |
| pb-hooks-credentials | 14/14 | 14/14 | | own PocketBase on 8089 |
| phone-bar-sizes-ui | 18/18 | 18/18 | | |
| playback-position | 7/7 | 7/7 | | |
| pranks-ui | 80/85 | 86/86 | | paused-sound checks updated (N6) |
| preferences-ui | 22/22 | 22/22 | | |
| privacy | 18/18 | 18/18 | | |
| public-origin | 6/6 | 6/6 | | |
| requests-ui | 9/9 | 9/9 | | |
| resume-position | 7/7 | 7/7 | | |
| searchbar-gap-ui | 17/17 | 17/17 | | |
| session-authorization | 22/22 | 22/22 | | hardcodes 8091/3010; run from a port-patched temporary copy |
| stream-fallback | 7/7 | 7/7 | | |
| stream-fastfail | 13/13 | 13/13 | | starts its own app |
| stream-range | 7/7 | 7/7 | | |
| stream-source | 13/13 | 13/13 | | |
| tabs | 39/40 | 39/40 | | (c) P6: `song_key` is `title::variant::artist` (`lib/songKey.ts`, unchanged since test-all), the test expects `title::artist` |
| tabs-fetch | 32/44 | 48/48 | | first run had `SONGSTERR_CDN_BASE` set wrong by me (needs `/cdn`) |
| tabs-generate | 24/25 | 24/25 | | (c) the same `song_key` expectation as tabs P6 |
| tabs-text | 33/33 | 33/33 | | |
| tabs-ui | 62/62 | 62/62 | | |
| themes-ui | 61/61 | 61/61 | | |
| toggles-ui | 8/8 | 8/8 | | |
| transcribe-timing | 8/8 | 8/8 | | |
| transfer | 17/18 | 19/19 | | E1 split into E1/E2 (W06) |
| transfer-google-ui | 31/31 | 31/31 | | fake Google |
| transfer-ui | 18/18 | 18/18 | | |
| trending-ui | 9/9 | 9/9 | | starts its own app |
| unavailable | crash | crash | same crash | (c) `lib/import/jobState.ts` uses TypeScript parameter properties, which Node's type stripping refuses; reached through `youtube.ts` then `musicCheck.ts` |
| unavailable-ui | 22/22 | 22/22 | | |
| uploads | 31/33 | 33/33 | | regression, fixed below |
| uploads-ui | 15/15 | 15/15 | | |
| voice-search-ui | 24/24 | 24/24 | | |
| watchdog (sh) | 85/85 | 85/85 | | |
| Python `tests/test_*.py` | all OK but ffmpeg_path | same | | ffmpeg_path as above |

**Skipped:** `tabs-sync` (needs the owner's hand-uploaded "Copper Sky" sample and its tab; there is no fixture for it), `pranks-realtime.spike` (a measurement spike, not a test), `android-auto-call.sh` and `android-native-log.mjs` (a real Android device or emulator).

## Regression found and fixed

- **A YouTube search failure hid a member's own uploads from search** (`e9d2b12`). S03 made a YouTube outage an error instead of an empty list, and `/api/search` awaited uploads and YouTube together, so when YouTube could not answer the whole search failed and matching uploads never showed. Found by `uploads.test.mjs` C2/C3 (ytmusicapi answered 400 for the test's query and the yt-dlp fallback found nothing). Now the outage is an error only when no upload matched; otherwise the uploads come back. Test: `apps/web/app/api/search/route.test.ts` ("still returns matching uploads when YouTube search fails" fails before the fix, passes after). uploads: 33/33 after.

## Tests updated for behaviour changed on purpose

- `access-control-ui` W01d (`1780a04`): signed-out `/api/…/x.js` now answers 401 JSON like any API path (W05), not 307.
- `pb-admin-exposure` B4 (`bb25d93`): finds the like by video id. The shared catalog is server-owned since W03, so when another suite already stored that video the like carries the stored title, not the one the test sent.
- `pranks-ui` (`29f5104`): a sound for someone whose music is paused now waits and then expires unheard (N6), instead of being marked skipped. The test checks it stays pending, the log says "waiting for their app", then "not delivered", and it waits out the 45 s so the pending sound cannot take the repeat's first play when the music comes back.
- `transfer` E (`c831000`): previews no longer spend the 5-per-hour limit (W06). E1 now checks six previews all answer 200, E2 that the sixth real start is a 429.

## Already failing before tonight, or environmental

- `collections`, `crash-report`, `ffmpeg-resolve`, `unavailable`: the same failure on `test-all` source (checked by running the suite on a `git archive` of test-all).
- `tabs` P6 and `tabs-generate` "the row is a shared generated alphaTex…": expect the old two-part `song_key`; `lib/songKey.ts` and both tests are unchanged since test-all.
- `layout-w09-admin-users` "the email isn't clipped": the sandbox's users are the other suites' throwaway accounts (`voice-search-50911-855420@ember.test` and the like), which are wider than a 390 px row and end in an ellipsis (282 px of text in a 266 px box). The stacked row itself is correct (screenshot checked). Not a regression, but the check depends on the data; it would be steadier asserting a minimum box width.

## Setup notes for the next run

- Always start PocketBase with `--automigrate=0` against a checkout's `pb_migrations`. Without it, the hooks that create collections on boot make PocketBase write new migration files into the checkout, and the next boot dies on `UNIQUE constraint failed: _migrations.file`.
- Hooks run in no fixed order on the first boot, so `ensure_session_members` and `ensure_uploads_artwork` can skip; restart PocketBase once after the first boot.
- Another agent briefly used 8089 during this run and the sandbox PocketBase went down; every suite that ran in that window was run again.
