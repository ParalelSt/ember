# Playlist imports (Spotify and YouTube Music)

Plan only. Read time: two to three minutes.

## 1. What exists today

| Piece | Where | State |
|---|---|---|
| Dialog: paste link, preview, import loop | `components/track/menus/ImportPlaylistDialog.tsx:44-137` | Works for YT Music. Import runs in the browser tab; closing it cancels (`:56`, `:151`). |
| `POST /api/import/inspect` | `app/api/import/inspect/route.ts:35-58` | Parses the link, 5 starts per 10 min per user (`:40`). |
| `POST /api/import/match` | `app/api/import/match/route.ts:17-39` | 8 items per call, 120 calls per min (`:22`). |
| Spotify read | `lib/sources/spotify.ts:85-116` | Client credentials. Broken: Spotify renamed `tracks` to `items` (Feb 2026) and now returns `items` only to the playlist owner. Every self-hoster hits this. |
| YT Music read | `player.py:636-651`, `lib/sources/youtube.ts:339-361` | `yt.get_playlist`, public only, no auth. |
| Matcher | `player.py:653-684` | One search per track, picks the first hit whose artist name overlaps, else hit 0. No duration, no explicit, no live/remix checks. Wrong matches are silent. |
| Tests | `tests/fake-player.sh:66-68`, `tests/ai-triage.test.mjs:604` | Fake `match` returns one fixed track. No import test, no matcher test, no Spotify test. |

Biggest weakness: Spotify import is dead, and the matcher cannot say "not sure".

## 2. Research (September 2026)

**Spotify.** Development mode apps now need the owner's Premium, are capped at 5 authorised users, and the old public-playlist read is gone (`items` only for playlists you own). Client credentials are useless for import. What still works:

| Path | Setup | Reads | Limits |
|---|---|---|---|
| Embed page `open.spotify.com/embed/playlist/<id>` (JSON in `__NEXT_DATA__`) | none | any public playlist, editorial too: name, cover, title, artists, duration ms, explicit | first 100 tracks, unofficial, may change shape |
| oEmbed `open.spotify.com/oembed` | none | name and cover only | official, use for preview |
| OAuth Authorization Code + PKCE, own app | app on developer.spotify.com, Premium, HTTPS redirect (loopback `127.0.0.1` is the only HTTP allowed, `localhost` refused) | `GET /me/playlists`, `GET /playlists/{id}/items` for own playlists, `GET /me/tracks` (Liked Songs), all pages | 5 users per app, no ISRC any more (`external_ids` removed) |

Recommendation: embed page as the default (zero setup, covers what people paste), OAuth as an optional add-on for Liked Songs, private playlists and playlists over 100 tracks. SETUP.md's current Spotify section is wrong and gets replaced.

**YouTube Music.** `ytmusicapi.get_playlist` reads public playlists without auth. Private playlists, Library and Liked Music need browser-header auth (`ytmusicapi browser`, headers valid about two years); ytmusicapi dropped OAuth. `yt-dlp --flat-playlist -J` is the fallback when ytmusicapi errors (it also reads plain YouTube playlists). Rapid ytmusicapi calls returned 503 in testing, so the runner must pace itself.

**Matching.** Neither side exposes ISRC now, so match on metadata. `search(filter="songs")` returns `title`, `artists`, `album`, `duration_seconds`, `isExplicit`, `videoType` (`ATV` audio, `OMV` official video, `UGC` upload).

## 3. Matching

`player.py match` returns the top 5 raw candidates per query. Scoring lives in TypeScript (`lib/import/score.ts`) so it runs in unit tests without Python.

| Signal | Points |
|---|---|
| Title similarity after normalising (case, accents, "feat.", "(Official Audio)", "Remastered 2011") | 0 to 45 |
| Any source artist equals any candidate artist (normalised) | +30, containment only +15 |
| Duration delta: 2 s or less +15, 6 s or less +8, over 15 s -20 | |
| Explicit flag equal +5, differs -10 | |
| Variant word on one side only (live, remix, acoustic, cover, karaoke, sped up, instrumental, nightcore) | -30 |
| `videoType`: ATV +5, OMV 0, UGC -10 | |

Score 75 or more: accepted. 50 to 74: review. Under 50 or no hits: not found (candidates kept). Two queries per track: `"title artist"`, then `"title"` with `ignore_spelling=True` if the first gives nothing above 50. The playlist never gets a silent guess.

## 4. Flow

1. Paste a link (Spotify playlist, YT Music playlist, YouTube playlist, `spotify.link` short link) or pick "Liked Songs" from a connected account.
2. Preview: name, cover, count, source. For Spotify over 100 tracks without OAuth, say so here.
3. Import starts a job. Dialog closes. The new playlist appears in the sidebar with a progress ring and fills as tracks are accepted.
4. Result summary on the playlist page: accepted, needs review, not found. Review count stays until resolved.

## 5. Jobs and storage

Two PocketBase collections, added by `pocketbase/pb_hooks/ensure_imports.pb.js` (same pattern as `ensure_tabs.pb.js`).

| Collection | Fields |
|---|---|
| `import_jobs` | user, source (`spotify`, `ytmusic`, `youtube`), kind (`playlist`, `liked`), source_id, source_url, name, cover_url, total, cursor, status (`queued`, `running`, `paused`, `done`, `failed`, `cancelled`), accepted, review, missing, playlist (relation), error |
| `import_items` | job, position, source_title, source_artists, source_duration_ms, source_explicit, source_uri, status (`accepted`, `review`, `missing`, `resolved`, `skipped`), video_id, confidence, candidates (JSON, top 5) |

Runner: `lib/import/runner.ts`, started from `instrumentation.ts` like the digest. One job at a time server-wide. It reads the next `queued` job, processes items from `cursor` in batches of 8 through one `player.py match` process, writes items and bumps `cursor` after each batch, appends accepted tracks with `upsertTrack` (`lib/upsertTrack.ts:12`) at `position = source index`. On boot any `running` job goes back to `queued`, so a restart resumes where it stopped. Pacing: 1.5 s between batches; on HTTP 503 or a Python failure wait 5 s, 20 s, 60 s, then `paused` with a "Retry" button. Progress: client polls `GET /api/import/jobs/:id` every 2 s while a job is open. Existing rate limits stay (starts per user); the per-batch limit goes away because the server owns the loop.

Playlists get two new fields, `source_url` and `import_job`, so re-sync is possible later.

As built (stages 3 and 4): items are created up front with status `pending` (so the playlist page can show the rows still waiting), and jobs carry four more fields: `retry_at` (paused by a backoff, when it tries again; empty means waiting for Retry), `runner` and `heartbeat` (a running job whose heartbeat is older than 30 s belonged to a server that stopped, so two servers on one PocketBase never run the same job), and `dismissed` (the Done summary was closed). A new job is held `paused` until its items exist, then queued. Code: `lib/import/{jobState,runner,store,runnerInstance,records,rows,reasons,nav}.ts`, routes under `app/api/import/{jobs,items}`, UI in `components/import/` and `components/track/menus/{CreatePlaylistDialog,ImportLinkForm}.tsx`.

## 6. Re-sync

Not in v1. Manual "Sync now" (add new source tracks at the end, never remove or reorder) is a later stage. Daily sync would need a source read per playlist per day against Spotify's quota; skip.

## 7. Scope for v1

| In | Out (later) |
|---|---|
| Public Spotify playlists (first 100 tracks) | Spotify over 100 tracks, Liked Songs, private playlists (OAuth stage) |
| Public YT Music and YouTube playlists | YT Music Liked Music and private playlists (browser headers, owner only) |
| Review list with candidate picking | Albums (already playable from search), re-sync |

## 8. UI

Entry point (decided): the create-playlist dialog (`apps/web/components/track/menus/CreatePlaylistDialog.tsx`) opens with a choice at the top: "Start empty" (today's flow) or "Import from a link". Import: paste a Spotify or YouTube Music link, preview (name, cover, song count), Create; the playlist appears at once and fills in the background with progress in the sidebar. The separate sidebar "Import playlist" button and ImportPlaylistDialog are removed, so there is one way in. Candidates for how the choice looks go on `/dizajn` inside `ShellPreview`, under `components/library/options/imports/`, picked before any UI is built.

Import flow candidates (all start from the create-playlist dialog):

| Id | Idea |
|---|---|
| A. Tabs | "Start empty" / "Import from a link" as tabs in the dialog header. |
| B. Cards | Two large option cards below the header. |
| C. Mode switch | Single dialog where pasting a link into the name field switches it to import mode. |

Review screen candidates:

| Id | Idea |
|---|---|
| A. Flagged rows | Rows needing review sit in the playlist with an amber dot; click opens a popover with 3 candidates (duration delta, type badge) and a search box. |
| B. Review sheet | Side sheet, one track at a time: source on the left, candidates on the right, keys 1 to 3, Skip. |
| C. Review queue page | Full page list of unresolved tracks with candidate cards; batch "accept all top picks above 65". |

## 9. Tests

| Level | What |
|---|---|
| Unit (vitest) | `parseImportUrl` (incl. `spotify.link`, YouTube), embed parser against a saved HTML fixture, `score()` on a fixture table (live vs studio, clean vs explicit, feat., remix, short/long duration), threshold buckets. |
| Server (sandbox) | `tests/fake-spotify.mjs` serves the embed fixture and oEmbed; `tests/fake-player.sh` `match` returns candidates from `tests/fixtures/ytm-candidates.json` keyed by query, with `FAKE_503_ONCE` for backoff. Checks: job completes, counts are right, positions follow the source, restart mid-job resumes, 503 pauses then resumes, second start within the limit is 429. |
| Browser (`tests/import-ui.test.mjs`, playwright-core) | Paste link, preview, close dialog, progress ring, open playlist, resolve one review item, track appears at its position. |

## 10. Stages

Each stage merges alone with a changelog entry in `lib/changelog.ts` and the next patch version per `docs/changelog-system.md`.

| Stage | Ships | Changelog line |
|---|---|---|
| 1 | Embed-page Spotify source, oEmbed preview, drop client credentials, rewrite SETUP.md section | "Spotify playlist import works again, no keys needed" |
| 2 | Candidates from `match`, `score()`, confidence, results list split into accepted, review, not found (still inside the dialog) | "Import matching is stricter and shows what needs a look" |
| 3 | `import_jobs`, `import_items`, runner, resume, pacing, sidebar progress (after dizajn pick) | "Imports run in the background" |
| 4 | Review screen (after dizajn pick) | "Fix uncertain import matches yourself" |
| 5 | YT Music likes through a Google sign-in (Liked Music, private), Spotify OAuth (Liked Songs, private, over 100) | "Import your liked songs" |
| 6 | Manual "Sync now" | later |

## 11. Transfer your YouTube Music liked songs

Built. The person signs in with Google, Ember reads their likes once with the YouTube Data API, signs itself out again, and turns the likes into a `kind: 'liked'` import. YouTube names the exact video of every like, so nothing is searched for and nothing needs reviewing: the items arrive with their candidate filled in and the runner accepts them as they are. Spotify and Apple Music are unchanged; the YouTube Music playlist link stays as the way in that needs no sign-in.

It uses Google's OAuth 2.0 device flow (the "TVs and Limited Input devices" client, https://developers.google.com/youtube/v3/guides/auth/devices) with one scope, `youtube.readonly`. Nobody pastes anything and nobody opens developer tools, and it works the same on a phone.

### What a friend sees

1. Settings, Library, Transfer, then **Liked songs**, **YouTube Music**, **I can sign in to my Google account**.
2. One button: **Sign in with Google**. Pressing it shows a short code in large letters (like `ABCD-EFGH`) and a button that opens google.com/device in a new tab, with "Waiting for you to allow Ember..." underneath.
3. On google.com/device (on the same computer, or on their phone) they type the code and pick their Google account.
4. While the app is in Testing and they are on the test-user list, Google shows **"Google hasn't verified this app"**. They press **Continue**. (If the owner published the app instead, the same warning appears for everyone; it is expected for a small private app.) If they are not on the test-user list, Google says **"Access blocked"** and Ember says to ask the owner to add their email.
5. Google asks whether Ember may **"View your YouTube account"**. They press **Continue** (or **Allow**), and Google says they can go back to their device.
6. Back in Ember, the line changes to "Google said yes. Reading your likes..." and then the usual preview: how many songs, the first few by name, and "Left out N likes that are not music." They press **Transfer N songs** and land on Liked songs with the transfer running.

The endings, each one sentence: "You said no on Google's page, so nothing was read.", "The code ran out. Press Sign in with Google to get a new one.", "This server is not set up for Google sign-in yet." (with the playlist link offered instead), and a few more for Google being down, a used-up daily quota, or an account Google blocks (all in `GOOGLE_MESSAGES`, `apps/web/lib/import/sources/ytmusicLiked.ts`).

### What the host sets up, once

1. Go to https://console.cloud.google.com and sign in with any Google account. Create a new project (top bar, project picker, **New project**), call it Ember.
2. **APIs & Services**, **Library**: search for **YouTube Data API v3** and press **Enable**.
3. **APIs & Services**, **OAuth consent screen** (in newer consoles: **Google Auth Platform**, **Branding** and **Audience**): user type **External**, app name Ember, your email as support and developer contact. Save. On the scopes step you can add `.../auth/youtube.readonly`, or leave it: Ember asks for it itself.
4. Who may sign in. Pick one:
   - **Testing** (the default): under **Test users** (or **Audience**, **Test users**) add each friend's Google email, up to 100. Only they can sign in; everyone else sees "Access blocked". Nothing to publish, no review.
   - **In production**: press **Publish app**. Anyone can sign in, but everyone sees Google's "unverified app" warning and has to press Continue, and Google caps an unverified app at 100 users in total. Google's own verification is not needed for a private group.
5. **APIs & Services**, **Credentials**, **Create credentials**, **OAuth client ID**. Application type: **TVs and Limited Input devices**. Name it Ember TV. Create. Google shows a **Client ID** (ends in `.apps.googleusercontent.com`) and a **Client secret** (starts with `GOCSPX-`).
6. Put both in `apps/web/.env.local` on the host:

   ```
   GOOGLE_OAUTH_CLIENT_ID=1234567890-abc.apps.googleusercontent.com
   GOOGLE_OAUTH_CLIENT_SECRET=GOCSPX-...
   ```

7. Restart Ember (`./update.sh`, or however the server is started). In the Transfer dialog the **Sign in with Google** button now works; before this step it says the server is not set up yet and offers the playlist link.

The client secret stays in `.env.local` on the host and is never sent to a browser. Quota: every 50 likes read cost 1 of the 10 000 units Google gives a project a day, so a 10 000-song library costs 200.

### How it is handled

| Rule | Where |
|---|---|
| `POST /api/import/liked/google` asks Google for a code and answers `{ flowId, userCode, verificationUrl, expiresIn, interval }`; `GET` on the same path answers `{ configured }` | `app/api/import/liked/google/route.ts` |
| The server polls Google's token endpoint at the interval Google gives (plus 5 s on `slow_down`); the dialog only asks `GET /api/import/liked/google/:flowId` every 2 s for `{ state: waiting, reading, ready, denied, expired, error, preview?, message? }` | `lib/import/google/flows.ts`, `components/import/TransferDialog.tsx` |
| Likes are read with `videos.list?myRating=like&part=snippet,contentDetails&maxResults=50`, paged to the end, newest first; music only (`categoryId` 10, or an auto-generated "- Topic" channel); at most 10 000 songs and 400 pages | `lib/import/google/client.ts`, `lib/import/google/likes.ts` |
| The tokens and the device code live in the server's memory only, keyed by an unguessable id tied to the Ember user, never in PocketBase, on disk, in a log, a bug report or a response | `lib/import/google/flows.ts` |
| The grant is revoked at `oauth2.googleapis.com/revoke` the moment the likes are read, and on cancel (`DELETE /api/import/liked/google/:flowId`, sent when the dialog closes or goes Back), on any error, and at the 15-minute limit | same |
| `POST /api/import/liked/google/:flowId/start` makes the `kind: 'liked'` job, exactly as the other routes do, and the flow is gone | `app/api/import/liked/google/[flowId]/start/route.ts` |
| Access tokens (`ya29.`), refresh tokens (`1//`), device codes (`AH-1N`), client secrets (`GOCSPX-`) and any `access_token`, `refresh_token`, `device_code`, `client_secret` field are scrubbed from every log line, bug report and error | `lib/import/redact.ts`, `lib/logger/sanitize.ts` |
| Ten sign-ins an hour per person, 90 status polls a minute, one sign-in at a time per person, 200 at once on the server | the routes, `MAX_FLOWS` |

`GOOGLE_OAUTH_BASE` and `YOUTUBE_API_BASE` point the server at a fake Google for tests.

YouTube does not say when a song was liked, so the like dates are synthesised from the order of the list, newest first, below every like the person already had (`lib/import/likedAt.ts`).

Tests: `lib/import/google/*.test.ts` (the device flow, the music filter, paging and the cap, the flow store's every ending), `app/api/import/liked/google/route.test.ts` (the four routes, and that no token reaches a response or a log), `lib/import/redact.test.ts`, `components/import/TransferDialog.test.tsx`, and `tests/transfer-google-ui.test.mjs` (a real browser against a fake Google).

This replaced an earlier way in that asked the person to copy the request headers of a signed-in music.youtube.com tab out of the browser's developer tools; that route (`POST /api/import/liked/ytmusic`, `player.py liked`) is gone.

## Decisions for the owner

1. Spotify default is the embed page with a 100-track cap, OAuth optional in stage 5? Recommended: yes.
2. Keep the source row for accepted matches too, so any imported track can be re-picked later? Recommended: yes, it is one relation.
3. Re-sync left out of v1? Recommended: yes.
