# Trending

The Home "Trending right now" shelf shows YouTube Music's real daily chart. The shelf is the feature: there is no separate `/trending` page. Shipped as 0.3.2.

## What was broken

Home shelf (`apps/web/app/(app)/page.tsx`) -> `useQueryTrending` (`hooks/useLibrary.ts`) -> `GET /api/youtube/trending` -> `player.py trending`.

ytmusicapi 1.12.2 `get_charts` returns `videos` as a list of chart playlists. `player.py` looked for `'items'` in it, found nothing, and silently fell back to `search('top hits')`, so the shelf was a search result, not a chart. `cmd_recommended` had the same dead branch.

## Source

Measured on 2026-09-18, anonymous, no cookies:

| Call | Result |
|---|---|
| `get_charts('ZZ')` | `videos`: "Daily Top Music Videos - Global" (`PL4fGSI1pDJn6t3TXLGiiJdD-sZbrG3tG0`) and "Top 100 Music Videos Global" |
| `get_charts('HR')` | returns Global: HR is not one of the 69 chart countries |
| `get_charts('DE')` | "Trending 20 Germany", "Daily Top Music Videos - Germany", "Top 100 Music Videos Germany" |
| `get_playlist(daily global)` | 50 tracks, all with `videoId`, all available |
| a second call within a second | HTTP 503 once, fine after a 3 s pause: cache, never fetch per page load |

`player.py trending`:

1. `get_charts(country)`, pick the playlist by title: "Daily Top Music Videos", then "Trending 20", then "Top 100". If `get_charts` fails, use the global daily id.
2. `get_playlist` on it (the same call playlist import uses). Entries without a `videoId` or with `isAvailable: false` are dropped.
3. Fallback: `yt-dlp --flat-playlist` on the same playlist id.
4. All failed: exit 1. The server then serves its cached list. No "top hits" search.

Output: `{ title, playlistId, source, tracks }`, tracks in rank order. `recommended` with no seed (or no watch playlist) uses the same chart.

## Region

As of 0.3.6 this is a blend of several countries, not one global chart; see
"As built: country blend" below for the current behavior. This section
describes the original single-country design: a host could set
`TRENDING_COUNTRY` (for example `DE`) in `apps/web/.env.local`, checked
against the chart country list, an unknown code (including `HR`) falling
back to `ZZ`. Per server, no settings UI. `TRENDING_COUNTRY` still works
exactly like this today; it just now also overrides the blend.

## Cache (`apps/web/lib/trending.ts`)

| Item | Choice |
|---|---|
| TTL | 6 h. Past it the old list is served at once and refreshed in the background, one refresh in flight. |
| Where | Memory, mirrored to `MUSIC_DIR/trending.json` so a restart serves it straight away. |
| Source down | Last good list, with its `fetchedAt` and `stale: true`. The source is retried at most every 5 minutes. |
| Cold start and source down | Empty list (the shelf hides), one warning in the server log. |

`GET /api/youtube/trending` returns `{ tracks, title, country, fetchedAt, stale }`. Tracks the server already marked unavailable are dropped, as `recommended/route.ts` does; ranks are positions after that. The search page, the search overlay and an empty playlist's track picker show the same cached chart when nothing is typed (Jamendo only fills in if no chart has ever loaded).

## Shelf design

Three candidates for the reworked shelf are on `/dizajn` ("Trending shelf"): Ranked cards, Chart list, Hero + list. Each has "Show all" opening the full chart as a collection page, and an "Updated 3 hours ago" note for stale data. The live shelf is unchanged until the owner picks one.

## As built: country blend (0.3.6)

Shipped 2026-09-19. The Global chart leans heavily toward India (YouTube
Music's largest audience), which does not fit every group of friends, so the
shelf now blends several countries' daily charts instead of using one.

`TRENDING_COUNTRIES` (comma list, default `US,GB,DE,RS`, verified live to
each have a "Daily Top Music Videos" chart on 2026-09-19) replaces the single
global chart. `TRENDING_COUNTRY` (single code) still works exactly as
before and wins when set, for hosts who already configured it.

The blend itself lives in `player.py` (`fetch_country_charts`,
`blend_charts`, wired through `cmd_trending`'s new `--countries` flag), not
in `lib/trending.ts`: fetching several countries' charts with a live,
paced `get_charts`/`get_playlist` call per country is Python-side work
already, and doing the merge right there means the TS layer keeps treating
"the chart" as one opaque fetch, unchanged except for what it caches.

1. `fetch_country_charts` fetches each country's `chart_tracks` in turn,
   pacing `CHART_FETCH_PACING_SEC` (3s) between live calls (the same 503 a
   rapid second call gave still applies per pair of calls). A country whose
   fetch fails is skipped, logged, and does not fail the others.
2. `blend_charts` merges the successful countries' charts with a
   Borda-style score: a song's points are the sum, over every country chart
   it appears in, of `(N - rank + 1)`. Ties break on the best (lowest)
   single rank. Songs are grouped by `videoId` OR by normalized
   title+artist (`normalize_song_key`), since the same song usually has a
   different `videoId` per country. Capped at 100.
3. `player.py trending --countries US,GB,DE,RS` prints
   `{ title, countries, tracks }`, where `countries` lists which countries
   actually made it into the blend (a country can drop out without failing
   the whole call). Every country failing still exits 1, same as before.
4. `lib/trending.ts` caches the blended list exactly as it cached the single
   chart before: same 6h TTL, same stale-while-revalidate, same mirror to
   `MUSIC_DIR/trending.json`. The cache key is the countries, comma-joined,
   so a `TRENDING_COUNTRIES` change (or an env restart from `TRENDING_COUNTRY`
   to the blend) does not serve a mismatched mirror.
5. `GET /api/youtube/trending` gained one new field, `source`: the country
   codes that made it into the current cached blend. Everything else
   (`tracks`, `title`, `fetchedAt`, `stale`) is unchanged, so the Home
   shelf, the search empty state and the track picker needed no changes.

## Tests

| Kind | What |
|---|---|
| `apps/web/lib/trending.test.ts` | saved player output to Tracks, TTL, stale fallback, cold start, restart from the mirror, country validation, order preserved, `resolveTrendingCountries` env parsing/validation/default blend/`TRENDING_COUNTRY` override |
| `tests/test_player_trending.py` | the playlist picker and fallback chain against saved `get_charts` / `get_playlist` output; `blend_charts` (Borda order, videoId + title/artist dedupe, tie-break, 100 cap), `fetch_country_charts` and `cmd_trending` (partial and total country failure, `--countries` parsing) |
| `tests/fake-player.sh` | a `trending` case blended per `--countries`: shared songs in every country plus country-exclusives, so the blend is exercised end to end; `FAKE_FAIL_TRENDING=1` to fail it |
| `tests/trending-ui.test.mjs` | Home shelf shows the blended order across `TRENDING_COUNTRIES`; the API's `source` field lists the blended countries; with the source failing after a good fetch it still shows the last good list |
