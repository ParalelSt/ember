# Trending now

Plan only. Goal: the "Trending right now" shelf shows a real chart, and a ranked page exists for it.

## What is there today

Home shelf (`apps/web/app/(app)/page.tsx:83`) -> `useQueryTrending` (`hooks/useLibrary.ts:72`) -> `GET /api/youtube/trending` (`app/api/youtube/trending/route.ts:9`) -> `getTrending` (`lib/sources/youtube.ts:263`) -> `player.py trending` (`player.py:612`).

The chain is broken at the end. ytmusicapi 1.12.2 `get_charts` no longer returns `songs` or `trending` lists; `videos` is now a list of chart playlists. `player.py:617-621` looks for `'items' in section` on that list, finds nothing, and silently falls back to `search('top hits')` (`player.py:626`). So the shelf is a search result, not a chart. `cmd_recommended` has the same dead branch (`player.py:386-392`). Search's "Trending" heading (`search/page.tsx:145`) is Jamendo popularity (`api/search/route.ts:31`), unrelated.

No scraper is needed. The chart is one public playlist away.

## 1. Source

Live calls on 2026-09-18 from the repo venv, anonymous, no cookies:

| Call | Result |
|---|---|
| `get_charts('ZZ')` | 0.9 s. `videos`: 2 playlists, "Daily Top Music Videos - Global" (`PL4fGSI1pDJn6t3TXLGiiJdD-sZbrG3tG0`) and "Top 100 Music Videos Global". `artists`: 40 ranked, with `rank` and `trend`. |
| `get_charts('HR')` | Returns Global. HR is not in the 69 supported countries (DE, AT, HU, IT, CZ, RS are). |
| `get_charts('DE')` | "Trending 20 Germany", "Daily Top Music Videos - Germany", "Top 100 Music Videos Germany". |
| `get_playlist(daily global)` | 1.4 s. 50 tracks, 50 with `videoId`, 50 `isAvailable`. Fields: title, artists, duration_seconds, thumbnails, views. |
| Second call within a second | HTTP 503 once. Fine after a 3 s pause. Cache, never fetch per page load. |

| Source | Playable | Key | Stable | Verdict |
|---|---|---|---|---|
| YT Music charts via ytmusicapi (`get_charts` + `get_playlist`) | videoId direct | none | already a dependency, same call as playlist import (`player.py:636`) | Primary |
| Same playlist via `yt-dlp --flat-playlist -J` | videoId direct | none | second parser for the same data, already installed | Fallback |
| charts.youtube.com page | yes | none | JS app, needs a headless browser | no |
| Apple Music / Spotify top 50 pages | no, one `match` call per track (50 searches) | Spotify API needs a key | scraping the pages is ToS-hostile | no |
| Last.fm `chart.getTopTracks` | no, resolve per track | free key per host, every friend registers one | stable | no |
| Billboard / Kworb | no, resolve per track | none | HTML scraping | no |

Recommendation: primary is the YouTube Music chart playlist through ytmusicapi. Pick it from `get_charts(country)['videos']` by title, in order "Daily Top Music Videos", "Trending 20", "Top 100"; keep the global daily id as a constant when `get_charts` itself fails. Fallback is yt-dlp on the same playlist id. Last resort is the cached list (section 3). Drop the "top hits" search fallback: it looks like a chart and is not one.

## 2. Region

Default Global. Croatia is not offered, and a neighbour's chart (RS, HU, AT) is not what the owner asked for. Per server, not per user: `TRENDING_COUNTRY` env var, validated against the country list, defaults to `ZZ`. No settings UI in v1. Friends who want Germany set one variable.

## 3. Freshness and caching

| Item | Choice |
|---|---|
| Refresh | Chart is daily. Cache TTL 6 h. Stale-while-revalidate: serve the cache at once, refetch in the background, one in-flight refresh at a time (pattern: `inFlight` at `lib/sources/youtube.ts:203`). |
| Where | In-memory, mirrored to `MUSIC_DIR/trending.json` so a restart serves the last list immediately. No PocketBase collection: no relations, no per-user data. |
| Shape | `{ country, fetchedAt, source: 'ytmusicapi' or 'yt-dlp', tracks: Track[] }`, rank is list position. |
| Source down | Serve the last good list, response carries `fetchedAt` and `stale: true`. UI shows "Updated 3 h ago" when older than 12 h. Cold start with no cache: empty list, shelf hidden, log one warning. |
| Cost | About 4 to 8 requests a day per server. Two Python spawns of about 1.5 s each per refresh. |

## 4. Where it shows

Keep the Home shelf, title "Trending now", it becomes real with no UI change. Add `/trending`: a ranked list using `TrackList showRank` (`components/track/TrackList.tsx:37`, rank cell at `TrackRow.tsx:215`), header with chart name, country, "Updated x ago", Play and Shuffle. Home's "Show all" points at `/trending` instead of `?focus=trending`. No sidebar row in v1.

Candidates for `/dizajn` (branch `design-gallery`, `apps/web/app/(app)/dizajn/page.tsx`, options under `components/library/options/`), new folder `options/trending/`:

1. Chart list: collection header with a cover mosaic of the top 4, then rows 1 to 50 with the rank column. Closest to existing pages.
2. Podium and list: top 3 as large cards side by side, rows 4 to 50 below. Movement arrows (up, down, new) from a diff against the previous cached list.
3. Shelf only: no page; Home cards get a rank badge, "Show all" stays the fullscreen shelf.

## 5. How tracks become playable

Chart entries are ordinary YouTube tracks. `player.py` maps each playlist item with `to_track_json` (`player.py:85`); `getTrending` runs `normalize` (`lib/sources/youtube.ts:145`), giving `id: youtube:<videoId>` and `streamUrl: /api/youtube/stream/<videoId>`. Play, like and add go through `ensureDownloaded` (`youtube.ts:224`) and `upsertTrack` (`lib/upsertTrack.ts:12`) exactly as search results do. Nothing is upserted ahead of time.

Entries without a `videoId` or with `isAvailable: false` are dropped in `player.py`. Tracks the server has already marked dead are filtered with `listUnavailableIds()` as `recommended/route.ts:11-12` does. Ranks are positions after filtering.

## 6. Tests

| Kind | What |
|---|---|
| Vitest `lib/trending.test.ts` | Parsing a captured playlist fixture into Tracks; TTL fresh vs stale; source error keeps the last good list and sets `stale`; cold start plus error gives an empty list; `HR` and junk fall back to `ZZ`. |
| Fake source | `tests/fake-player.sh` gets a `trending` case (like `recommended`) returning fixed ranked JSON, plus `FAKE_FAIL_TRENDING=1` to exit 1. No test touches the internet. |
| Python | One `unittest` for the playlist picker with a saved `get_charts` output, so a shape change fails a test instead of silently regressing again. |
| Browser | `tests/trending-ui.test.mjs`: sandbox with the fake player, open `/trending`, assert ranks 1 to N and the "Updated" text; set `FAKE_FAIL_TRENDING=1`, reload, list still there with the stale note. |

## 7. Changelog

Entry at the top of `apps/web/lib/changelog.ts:22`: `id: 'trending-now'`, version `0.3.1`, summary "Home shows the real YouTube Music top chart, refreshed every few hours." Bump `apps/web/package.json` with `npm version patch --no-git-tag-version`. `UPDATE_NOTES.md` gets one line about the optional `TRENDING_COUNTRY` variable. Commit `chore(release): 0.3.1` per `docs/changelog-system.md` section 5.

## Order of work

1. `player.py`: rewrite `cmd_trending` (charts -> playlist -> yt-dlp), reuse it in `cmd_recommended`'s fallback.
2. `lib/trending.ts` cache and the route response `{ tracks, fetchedAt, stale, country }`. Home works again here.
3. `/dizajn` candidates, owner picks, then `/trending` page.
4. Tests, fake-player case, changelog and version bump.

Implementer: sonnet-worker. Steps 1 and 2 can ship as 0.3.1 before the page.

## Decisions for the owner

1. Global chart, since Croatia is not offered? Recommended: yes, with `TRENDING_COUNTRY` for hosts who want a country.
2. Full `/trending` page as well as the Home shelf? Recommended: yes, built after the `/dizajn` pick.
3. Ship the data fix (steps 1 and 2) before the page? Recommended: yes, as 0.3.1.
