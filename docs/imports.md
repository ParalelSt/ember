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

## 6. Re-sync

Not in v1. Manual "Sync now" (add new source tracks at the end, never remove or reorder) is a later stage. Daily sync would need a source read per playlist per day against Spotify's quota; skip.

## 7. Scope for v1

| In | Out (later) |
|---|---|
| Public Spotify playlists (first 100 tracks) | Spotify over 100 tracks, Liked Songs, private playlists (OAuth stage) |
| Public YT Music and YouTube playlists | YT Music Liked Music and private playlists (browser headers, owner only) |
| Review list with candidate picking | Albums (already playable from search), re-sync |

## 8. UI

Entry points stay: "Import" in the create-playlist dialog (`components/nav/Sidebar.tsx:97`) and the Library page. Candidates go on `/dizajn` inside `ShellPreview`, under `components/library/options/imports/`, picked before any UI is built.

Import flow candidates:

| Id | Idea |
|---|---|
| A. Dialog and ring | Two-step dialog (link, preview). Then the sidebar playlist row shows a progress ring and "42 of 120". |
| B. Import page | `/import`: link box on top, list of past and running jobs with bars, Retry and Cancel. |
| C. Empty playlist fill | Paste the link on a new empty playlist page; rows appear as they land, a banner shows progress. |

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
| 5 | YT Music browser headers (Liked Music, private), Spotify OAuth (Liked Songs, private, over 100) | "Import your liked songs" |
| 6 | Manual "Sync now" | later |

## Decisions for the owner

1. Spotify default is the embed page with a 100-track cap, OAuth optional in stage 5? Recommended: yes.
2. Keep the source row for accepted matches too, so any imported track can be re-picked later? Recommended: yes, it is one relation.
3. Re-sync left out of v1? Recommended: yes.
