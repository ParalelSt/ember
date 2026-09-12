# Tests

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
  the type utility strings before they existed).
- `stores/`: `usePlayerStore` actions (toggleShuffle, cycleLoopMode,
  toggleMuted).
- `components/primitives/`, `components/page/`: `Artwork`, `PlayButton`,
  `LikeButton`, `PageTitle`/`SectionHeader`/`Eyebrow`/`EmptyState`,
  `CollectionHeader`: pure, props-in components.
- `components/track/`: `TrackRow`, `TrackList`, `TrackCard`, `TrackShelf`.
- `components/nav/`: `NavLinks`.
- `components/player/`: `SeekBar`, `TransportControls`, `VolumeControl`,
  `NowPlayingSummary`, and `PlayerProvider.test.tsx` (a mocked-backend
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

# 3. Build once (turbopack dev is unreliable here: always test a real build)
cd apps/web && npx next build --webpack

# 4. Two app servers: one WITH an AI key, one WITHOUT.
#    MAX_UPLOAD_MB=1 keeps the uploads "too large" case fast.
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
node tests/tabs.test.mjs                            # or: npm run test:tabs
node tests/tabs-ui.test.mjs                         # or: npm run test:tabs-ui
node tests/android-player-ui.test.mjs               # or: npm run test:android-ui
node tests/offline-android-ui.test.mjs              # or: npm run test:offline-ui
node tests/offline-page.test.mjs                    # or: npm run test:offline-page (no server needed)
node tests/resume-position.test.mjs                 # or: npm run test:resume
node tests/playback-position.test.mjs               # or: npm run test:position
node tests/public-origin.test.mjs                   # or: npm run test:origin
node tests/toggles-ui.test.mjs                      # or: npm run test:toggles
node tests/collections.test.mjs                     # or: npm run test:collections (no server needed)
node tests/library-collections-ui.test.mjs          # or: npm run test:library-ui

# Privacy switches
node tests/privacy.test.mjs                         # or: npm run test:privacy

# Desktop update feed (needs its own server: see the section below)
node tests/desktop-update.test.mjs                  # or: npm run test:update

# Where audio comes from (needs its own server: see the section below)
node tests/desktop-logger.test.mjs                  # or: npm run test:desktop-logger
node tests/stream-source.test.mjs                   # or: npm run test:stream
node tests/stream-fallback.test.mjs                 # or: npm run test:stream-fallback

# Custom uploads (MUSIC_DIR must match the server's)
MUSIC_DIR="$SB/music" node tests/uploads.test.mjs   # or: npm run test:uploads
node tests/uploads-ui.test.mjs                      # or: npm run test:uploads-ui

# Unavailable songs: detection, replace, skip-on-play (needs its own server, see below)
node tests/unavailable.test.mjs                     # or: npm run test:unavailable
node tests/unavailable-ui.test.mjs                  # or: npm run test:unavailable-ui
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
- Every admin route (users, tracks, logs, invites, cleanup) refuses a normal
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
