# R1. Final integration run of the merged bughunt branch

**What was run:** every `tests/*.mjs` suite R0 ran, the suites added since (`access-control-2-ui`, `stale-session-ui`, `pb-hooks-tabs-index-repair`, the eight new `layout-v*` suites), `tests/watchdog.test.sh`, the `tests/test_*.py` unittests and `npx vitest run` in `apps/web`, against a real `next build --webpack` of `bughunt` at `6f36db0` (rounds 3 to 5 on top of R0's `3d1a2db`). Set up as in R0, on other ports: a fresh throwaway PocketBase on 8087 (`migrate up` with no hooks first, then a restart, `--automigrate=0`) over a scratch copy of this worktree's `pb_hooks` and `pb_migrations`, superuser and owner from `EMBER_PB_SUPERUSER_*` / `EMBER_ADMIN_*`, the app on 3052. Every Discord webhook (bug, crash, feature, fix) pointed at a local sink; the fake Anthropic, fake Songsterr/UG, fake Spotify, fake Google, fake GitHub and `tests/fake-player.sh` stood in for everything external. Suites that need a server config of their own (fake player, 1 MB upload cap, sinks on 8099, fake GitHub, no API key) got the app on 3052 restarted with that config; suites that start their own app were given `APP_PORT=3052`, the `pb-hooks-*` suites `PB_PORT=8086`. The owner's sandboxes (3050/8088, 3051/8089) and 3000/8090 were never touched.

**Result:** no regression from rounds 3 to 5 found in the app. 2 suites expected behaviour that was changed on purpose (O9, O7) and were updated; 4 layout suites were written against a small private seed and failed on a sandbox the other suites had filled, so their checks were made data-proof; the other first-run failures were my harness or run order. After that, every suite passes. `npx vitest run` in `apps/web`: 268 files, 2988 passed.

T1 to T4 are confirmed: `collections`, `unavailable`, `crash-report`, `ffmpeg-resolve`, `tabs` P6 and `tabs-generate` all pass now (R0's six pre-existing failures).

## Suites

"First run" is the first run on this build in a full sequential pass; "after" is after the test updates below (or a rerun in the right config).

| Suite | First run | After | Notes |
|---|---|---|---|
| access-control-ui | 22/22 | 22/22 | |
| access-control-2-ui | 37/37 | 37/37 | new since R0. Its X1 probe spends the IP's check-email allowance (10 per 10 min), see changelog-ui |
| ai-triage | 87/90 | 90/90 | E1, E2, E4 need a no-key server; run again against 3052 restarted without a key, with a fresh user: all pass (as in R0) |
| ai-triage-ui | 25/25 | 25/25 | |
| android-player-ui | 11/12 | 12/12 | (c) "not echoed back to the native player" 3 -> 4 once, while vitest ran alongside; 4 reruns all pass |
| attachments-ui | 38/38 | 38/38 | sinks on 8099 |
| authorization | 17/17 | 17/17 | |
| changelog-ui | crash | 28/28 | (c) run order: signs in through the form after access-control-2-ui had used up the check-email allowance, so the password step never came. Passes after an app restart |
| collections | 10/10 | 10/10 | fixed by T1 (R0: crash) |
| crash-report | 34/34 | 34/34 | fixed by T2 (R0: 33/34) |
| desktop-logger | 5/5 | 5/5 | |
| desktop-update | 19/19 | 19/19 | fake GitHub |
| ffmpeg-resolve | 9/9 | 9/9 | fixed by T3 (R0: 8/9) |
| import | 39/39 | 39/39 | |
| import-ui | 24/24 | 24/24 | starts its own app |
| instant-search-ui | 77/77 | 77/77 | |
| layout-v1-player-bar | 19/21 | 21/21 | (b/c) test updated, see below |
| layout-v3-session-dialog | 8/8 | 8/8 | |
| layout-v6-nowplaying-header | 5/5 | 5/5 | |
| layout-v7-new-playlist-dialog | 10/10 | 10/10 | |
| layout-v8-tablet | 13/13 | 13/13 | |
| layout-v11-library-header | 5/5 | 5/5 | |
| layout-v12-back-to-top | 14/16 | 16/16 | (b/c) test updated, see below |
| layout-v13-small-fixes | crash | 7/7 | (b/c) test updated, see below |
| layout-w09-admin-users | 5/6 | 6/6 | (c) R0's data-dependent failure; check hardened as R0 suggested |
| layout-w10-playlist-header | 7/7 | 7/7 | |
| layout-w11-settings-tabs | 5/5 | 5/5 | |
| library-collections-ui | 41/41 | 41/41 | |
| likes-order | 5/5 | 5/5 | |
| marquee-ui | 12/12 | 12/12 | |
| mobile-player-ui | crash (16/18) | 101/101 | (b) O9, updated |
| offline-android-ui | 20/20 | 20/20 | |
| offline-page | 35/35 | 35/35 | |
| offline-web-ui | 0/1 | 5/5 | (b) O7, updated |
| pb-admin-exposure | 25/26 | 26/26 | (c) B6 got a 429 from check-email, same run-order cause as changelog-ui; passes after a restart |
| pb-hooks-credentials | 14/14 | 14/14 | own PocketBase on 8086 |
| pb-hooks-tabs-index-repair | 4/4 | 4/4 | new since R0; own PocketBase on 8086 |
| phone-bar-sizes-ui | crash | 18/18 | (b) O9, updated |
| playback-position | 7/7 | 7/7 | |
| pranks-ui | 86/86 | 86/86 | |
| preferences-ui | 22/22 | 22/22 | |
| privacy | 18/18 | 18/18 | |
| public-origin | 6/6 | 6/6 | |
| requests-ui | 9/9 | 9/9 | |
| resume-position | 7/7 | 7/7 | |
| searchbar-gap-ui | 17/17 | 17/17 | |
| session-authorization | 22/22 | 22/22 | hardcodes 8091/3010; run from a port-patched temporary copy |
| stale-session-ui | 17/17 | 17/17 | new since R0 (V5) |
| stream-fallback | 7/7 | 7/7 | |
| stream-fastfail | 13/13 | 13/13 | starts its own app |
| stream-range | 7/7 | 7/7 | |
| stream-source | 13/13 | 13/13 | |
| tabs | 40/40 | 40/40 | fixed by T4 (R0: 39/40) |
| tabs-fetch | 48/48 | 48/48 | |
| tabs-generate | 25/25 | 25/25 | fixed by T4 (R0: 24/25) |
| tabs-text | 33/33 | 33/33 | |
| tabs-ui | 62/62 | 62/62 | |
| themes-ui | 61/61 | 61/61 | |
| toggles-ui | 8/8 | 8/8 | |
| transcribe-timing | 8/8 | 8/8 | |
| transfer | 12/19 | 19/19 | (c) first run was on the plain app; needs the fake player and match fixture |
| transfer-google-ui | crash | 31/31 | (c) my harness: I put a `music` folder in the `EMBER_LOG_DIR` the test reads file by file |
| transfer-ui | 18/18 | 18/18 | |
| trending-ui | 9/9 | 9/9 | starts its own app |
| unavailable | 46/46 | 46/46 | fixed by T1 (R0: crash) |
| unavailable-ui | 3/22 | 22/22 | (c) first run was on the plain app; needs the fake player |
| uploads | 33/33 | 33/33 | 1 MB cap |
| uploads-ui | 15/15 | 15/15 | |
| voice-search-ui | 24/24 | 24/24 | |
| watchdog (sh) | 77/85 | 85/85 | (c) first run was under `nohup`, which makes SIGHUP ignored for the child shells, so the hangup scenarios could not trap it. 85/85 run in the foreground |
| Python `tests/test_*.py` | all OK | all OK | 96 tests in 10 files, `test_ffmpeg_path` included (T3) |
| vitest (`apps/web`) | 2988/2988 | 2988/2988 | 268 files |

**Skipped (as in R0):** `tabs-sync` (needs the owner's hand-uploaded sample), `pranks-realtime.spike` (a measurement spike), `android-auto-call.sh` and `android-native-log.mjs` (a real device or emulator).

**Not on the branch:** `tests/update-script.test.sh` lives on `bh-ops4` (O1, O2, O3, O5, O6), which is **not merged into `bughunt`**. `git merge-tree` says it merges cleanly. On a `git archive` of that trial merge, `update-script.test.sh` passed 84/84. `watchdog.test.sh` failed 13 of 124 there: all in O3's `.env.local` section, which loads `@next/env` from `node_modules`. A bare archive has no `node_modules`, and `bh-ops4` alone fails the same 13 the same way, so the merge did not cause it. Run the watchdog again in a real worktree once `bh-ops4` is merged.

## Regressions found

None in the app. No product code changed on `bh-r1`.

## Tests updated for behaviour changed on purpose

- `mobile-player-ui` and `phone-bar-sizes-ui` (`4884eb4`): O9 made the phone bar's title row a real "Open player" button. The bar now has three buttons: Open player, Play/Pause, Next. mobile-player-ui expects that list and clicks play by its label, not "first button". Before this, the first button was Open player, so "play pauses without opening the full-screen view" opened the view and the run crashed. phone-bar-sizes-ui measures the controls without the title button. Before this, it read an icon that the title button does not have and crashed.
- `offline-web-ui` (`ffb0d26`): O7 changed the web Download button's tooltip to "Plays offline while Ember stays open in this tab". Only Android keeps "Save this collection for offline playback". The test finds the button by its name, "Download for offline".

## Tests made independent of sandbox data

These four were written against a small private seed. On a sandbox that 60 other suites had already filled, they failed for reasons unrelated to what they check. The layouts were all correct: I checked each one with a screenshot or a measurement.

- `layout-v13-small-fixes` 4 (`dbaf527`): the test took every `upload:` catalog row and looked for the first one on Admin > Tracks. The page shows 50 rows, newest first, and the sandbox had 99, so that row sat on page 2 and the wait timed out. Now the test only looks at the upload rows the first page shows.
- `layout-v1-player-bar` (`1f6b1a6`): "like, add and share sit beside the title" wanted a button labelled "Like". The seed user already liked a "Let Down" by Radiohead, so the variant rule filled the heart and labelled it "Unlike". The check now accepts either label.
- `layout-v12-back-to-top` (`deb337a`): at 390 on the playlist page, the check counted an "Add" button from Recommended songs as sitting under Back to top. The real player filled that list here. That "Add" belongs to a row scrolled out of the list's own inner scroller (`max-h-96 overflow-y-auto`), so nobody can see it; the screenshot shows nothing under the button. The page itself does end with its `pb-section` room. The check now clips each control to the overflow boxes it sits in before testing for overlap. A control that really is under the button still fails.
- `layout-w09-admin-users` (`4d8fd4e`): R0's data-dependent failure. The throwaway emails are wider than a 390 px row and end in an ellipsis. Following R0's suggestion, a box at least 200 px wide now passes. The original bug was a 42 px box ("voic…"), and that still fails.

## Setup notes for the next run

- The check-email limit (X1: 10 per 10 minutes per caller, kept in the app's memory) is shared by every suite in a run. `access-control-2-ui` uses it all up on purpose. After that suite, restart the app before any suite that signs in through the form (`changelog-ui`) or calls check-email (`pb-admin-exposure` B6). Or run it last.
- Do not start `watchdog.test.sh` under `nohup`: SIGHUP stays ignored for its child shells and the hangup checks fail.
- `EMBER_LOG_DIR` for `transfer-google-ui` must hold only log files.
- The layout suites need seed data for the owner account: a playlist with 20 or more songs, one with a 60+ character name, the W10 long name, one track in a playlist, 12 or more likes, an upload with its record and three without, and a user with a 40+ character email. The scratch `seed.mjs` from V5c, pointed at the sandbox, covers all of it plus the W10 playlist.
- As in R0: `migrate up` with an empty hooks dir first (PocketBase 0.22 runs the hooks before the system tables exist otherwise), then boot with the hooks, then restart once.
