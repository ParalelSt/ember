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

Global (`ZZ`) by default. A host can set `TRENDING_COUNTRY` (for example `DE`) in `apps/web/.env.local`. It is checked against the chart country list; an unknown code (including `HR`) falls back to `ZZ`. Per server, no settings UI.

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

## Tests

| Kind | What |
|---|---|
| `apps/web/lib/trending.test.ts` | saved player output to Tracks, TTL, stale fallback, cold start, restart from the mirror, country validation, order preserved |
| `tests/test_player_trending.py` | the playlist picker and fallback chain against saved `get_charts` / `get_playlist` output |
| `tests/fake-player.sh` | a `trending` case, `FAKE_FAIL_TRENDING=1` to fail it |
| `tests/trending-ui.test.mjs` | Home shelf in rank order; with the source failing after a good fetch it still shows the last good list |
