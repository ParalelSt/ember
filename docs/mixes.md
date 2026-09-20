# Mixes and genre playlists

Plan only. Spotify-style mixes for Ember: genre charts anyone can browse, and several personal mixes built from what each member plays. Nothing here is built yet.

## 1. What exists today

| Piece | Where | What it gives us |
|---|---|---|
| Trending | `player.py:779` `cmd_trending`, `fetch_country_charts` (`:725`, 3 s pacing at `:713`), `blend_charts` (`:741`) | A blended daily chart, cached 6 h in `apps/web/lib/trending.ts:17`, mirrored to `MUSIC_DIR/trending.json` (`:191`), stale-while-revalidate |
| Recommended | `player.py:383` `cmd_recommended` (`get_watch_playlist`, `:390`), `lib/sources/youtube.ts:300` `getRecommended` | Up to 30 songs similar to one seed videoId; chart fallback |
| Radio | `lib/playback/radio.ts:33` `rankRadioPool`, `hooks/player/useRadioExtend.ts:56` | Pure ranking: variant blocking by `songKey` (`lib/songKey.ts:19`), front-load known songs, weave |
| Home | `app/(app)/page.tsx:80-85` | Four shelves: Because you played, Trending, Liked, Recently played |
| History | `plays` collection (`pocketbase/pb_migrations/1748150000_init_schema.js:99-104`): `user`, `track`, `played_at` only | One row per track start (`components/player/PlayerProvider.tsx:474`). No duration, no skip, no position. Never deleted (`lib/cleanup.ts` only prunes files). `/api/history` returns the last 50 deduped (`app/api/history/route.ts:11-24`) |
| Likes, playlists, uploads | `/api/likes`, `/api/playlists`, `lib/uploads.ts` | Explicit taste signals |
| Friends | `app/api/listening/route.ts:24` | Other members' plays, filtered to `share_listening` opt-in |
| Track metadata | `player.py:95` `to_track_json`, `lib/sources/youtube.ts:146` `normalize`, `lib/upsertTrack.ts:38-45` | title, artist, artistId, album, albumId, duration, artwork. No genre anywhere |

So a mix can be built from: which tracks a person started, how often, when, what they liked, and who else played what. Not from how long they listened.

## 2. Where genres come from

Measured live on 2026-09-20 with ytmusicapi 1.12.2, anonymous, 3 s between calls:

| Source | Real shape | Verdict |
|---|---|---|
| `get_charts('US')['genres']` | 8 "Top 50 ... Music Videos United States" playlists: Pop, Hip Hop, Rock, Hard Rock & Metal, Dance & Electronic, Latin, Country & Americana, Jazz. `GB` and `DE` return an empty `genres` list | Primary for genre charts. One call lists them, one `get_playlist` per genre fills them |
| `get_mood_categories()` | 24 genres (adds R&B & soul, Indie & alternative, Classical, K-Pop, Metal alone, Blues, Folk, Reggae, J-Pop, Soundtracks, Decades, regional ones) and 12 moods (Chill, Energize, Feel good, Focus, Gaming, Party, Romance, Sad, Sleep, Workout, Commute, Christmas). Stable `params` | Primary for browse genres and moods |
| `get_mood_playlists(params)` | Crashes in 1.12.2 (`KeyError navigationEndpoint`, a song row without a link inside the category page). Not a rate limit | Usable after an upgrade check, else read the raw browse response and skip rows without a `playlistId` |
| Artist or album metadata on stored tracks | `get_artist` and `get_album` expose no genre | Not a source |
| Offline artist-to-genre index | Any artist appearing in a fetched genre chart or genre playlist gets that genre. Zero extra calls | Primary for tagging a member's plays |
| last.fm `artist.getTopTags` | Free key, one call per new artist, cached forever in `artist_genres` | Fallback for artists the lists never mention. Off until `LASTFM_API_KEY` is set |

Recommendation: ytmusicapi is the primary source (genre charts, browse genres, moods, and the artist index derived from them) because it already returns playable videoIds and needs no new key. last.fm is the fallback for tagging only. A song with no genre stays in every non-genre mix and simply does not count toward genre mixes; a genre mix is only built when a member has at least 8 tagged plays in it.

## 3. The list

Per person = built from that member's plays and likes. Per server = the same for everyone. "No new data" = buildable from PocketBase today, zero YouTube calls.

| Shelf or mix | Scope | Songs come from | New data |
|---|---|---|---|
| Your Daily Mix | person | Watch playlists of the 5 most played songs in 30 days, weaved with known songs like radio | calls |
| Your Metal Mix, Your Pop Mix, ... (up to 4) | person | One per genre with 8+ tagged plays in 60 days; seeds are the top played songs in that genre, candidates whose artist is tagged another genre are dropped | calls |
| New to you | person | The union of all seeded pools above, minus anything ever played or liked (by `songKey`) | reuses pools |
| Back again | person | Songs played 30 to 180 days ago and not in the last 30, by play count | none |
| On repeat | person | Most started songs in the last 30 days | none |
| Artist mix: {artist} (top 3 artists) | person | The artist's top songs (`player.py artist`) weaved with the watch playlist of the member's most played song by them | calls |
| Friends mix | person | Plays by other members with `share_listening` in 14 days, minus the member's own plays, ranked by distinct listeners then recency | none |
| Because you played (exists) | person | Watch playlist of the last play | exists |
| From your liked songs, Recently played (exist) | person | Likes, plays | exists |
| Trending right now (exists) | server | Blended daily chart | exists |
| Genre charts row: Pop, Hip hop, Rock, Metal, EDM, Latin, Country, Jazz | server | The 8 US "Top 50" genre chart playlists, each opening as a chart page | calls |
| Genres row: R&B, Indie, Classical, K-pop, Blues, Folk, Reggae, J-pop, Soundtracks, Dance, Hip-hop, Rock, Metal, Pop, Latin, Country, Jazz, African, Arabic, Bollywood, Mandopop | server | The first playlist of each browse genre category | calls |
| Moods row: Chill, Energize, Feel good, Focus, Gaming, Party, Romance, Sad, Sleep, Workout, Commute, Christmas (seasonal) | server | The first playlist of each mood category | calls |
| Decades row: 60s to 2010s | server | The "Decades" browse category's playlists | calls |
| Mood of the day | server | One mood playlist picked by hour (Focus in the morning, Energize afternoon, Chill at night), refreshed daily | reuses moods |
| Popular on this server | server | Most started songs by opted-in members in 30 days, counts only, no names | none |

Home order: Your mixes (tiles: Daily, genre mixes, New to you, Back again, On repeat, artist mixes, Friends), Because you played, Trending, Genre charts, Genres, Moods, Decades, Liked, Recently played. The "Your mixes" row hides until a member has 10 plays; the no-call mixes appear first because they need nothing from YouTube.

## 4. How each mix is built

Every builder is a pure function over (plays, likes, catalog, pools), tested without the network, the same split as `rankRadioPool`.

| Mix | Seed | Candidates | Dedupe and already-played | Size | Refresh |
|---|---|---|---|---|---|
| Daily Mix | top 5 played songs, 30 days | watch playlist per seed | `songKey` across pools and queue; keeps ~1 in 3 known songs (radio weave) | 50 | daily |
| Genre mixes | top 3 tagged songs per genre | watch playlist per seed | as Daily, plus drop artists tagged a different genre | 40 | daily |
| New to you | none (reuses pools) | Daily + genre + artist pools | drop any `songKey` in plays or likes | 30 | daily |
| Back again | none | plays 30 to 180 days old | one per `songKey`, skip last-30-day plays | 30 | daily, no calls |
| On repeat | none | plays, 30 days | one per `songKey`, by count then recency | 30 | hourly, no calls |
| Artist mix | top 3 artists by plays, 90 days | `artist` top songs + one watch playlist | as Daily; at most 60 % one artist so it drifts | 30 | weekly |
| Friends mix | none | others' plays, 14 days, opted in | drop the member's own `songKey`s | 30 | hourly, no calls |
| Genre charts, genres, moods, decades | none | catalog playlists | unavailable ids dropped as in `trending/route.ts` | 50 | daily |

Tracks unavailable per `listUnavailableIds` are dropped everywhere, as the trending route does.

## 5. Storage and cost

| What | Where | Why |
|---|---|---|
| Catalog: genre charts, browse genre, mood and decade playlists, artist-to-genre index | `MUSIC_DIR/mixes/catalog.json`, in memory, same cache class as `lib/trending.ts` (24 h TTL, stale-while-revalidate, 5 min retry) | Server-wide, survives restart, no schema change |
| Personal mixes | New PocketBase collection `mixes`: `user`, `kind`, `key` (genre or artist), `title`, `tracks` (JSON of track record ids after `upsertTrack`), `seeds`, `built_at`. Unique on (`user`, `kind`, `key`) | Survives restart, per-user rules like `plays`, listable offline |
| Artist tags | Collection `artist_genres`: `artist_key`, `genres`, `source` | Built once, reused by every member |

Cost per refresh, paced 3 s like `CHART_FETCH_PACING_SEC`: catalog is 1 `get_charts` + 8 chart playlists + about 20 browse categories + 20 playlists, roughly 50 calls, 2.5 min, once a day. One member is about 5 + 12 + 6 watch or artist calls, about 1 min. Six members are 6 min a night. All of it goes through one new `player.py mixes --user-seeds <json>` invocation per member so pacing lives in one process, queued through `lib/pythonJobs.ts:12` `queuePythonJob` so it never overlaps a tab transcription or another member's build. Trigger: a server timer at 04:00, plus a lazy check on Home load that only enqueues when a member's mixes are older than 24 h and serves the old ones meanwhile. Rapid calls answered 503 in testing, so nothing fetches per page load.

Offline or cold server: PocketBase rows and `catalog.json` serve as they are with "Built 2 days ago" on the tile. First ever boot: the no-call mixes build at once; the rest appear after the first nightly run. A YouTube outage keeps the last good rows, exactly as trending does.

## 6. UI

Home gains a "Your mixes" tile row and three browse rows; two new pages: `/mix/[id]` (a personal mix, play, shuffle, add to playlist) and `/genre/[slug]` (a chart or browse playlist, reusing the collection page the trending "Show all" opens). Each tile shows a generated cover (the top 4 artworks) and a one-line reason ("Because you play Gojira").

The owner requires options on `/dizajn` before any of this is built, next to "Trending shelf" (`components/library/options/trending/index.ts:12-25`):

Home layout candidates:
1. Mix tiles first: one big square-tile row of mixes at the top, browse rows below as small round genre chips.
2. Sections by source: "Made for you", "Charts", "Browse" headers with a one-line description each, all shelves the same height.
3. Quick grid: a 2 by 4 grid of the member's mixes above the existing shelves, genres as a colored tile wall at the bottom (closest to Spotify).

Mix page candidates:
1. Hero + list: large cover, title, reason, "Built today", then a dense track list (matches the existing "Hero + list" trending option).
2. Reasoned list: no hero; each row carries a small "because ..." seed label and the genre tag, built for scanning.

## 7. Tests

| Kind | What |
|---|---|
| `apps/web/lib/mixes/*.test.ts` (vitest) | Each builder with fixture plays and a fixture catalog: seed picking, genre thresholds, `songKey` dedupe, already-played exclusion, size caps, friends opt-in filtering, refresh age |
| `tests/test_player_mixes.py` | Catalog parser against saved `get_charts('US')` and raw browse responses (save the real ones as fixtures, including the row that crashes 1.12.2); `mixes` command pacing and partial failure |
| `tests/fake-player.sh` | New `genres` and `mixes` cases with deterministic songs, `FAKE_FAIL_MIXES=1` |
| `tests/mixes-ui.test.mjs` (browser) | Log in, play two songs, reload Home, the "Your mixes" row shows On repeat, open a genre chart page, play its first song |

## 8. Stages

| Stage | Ships | Tier | Changelog |
|---|---|---|---|
| 1 | `/dizajn` candidates for Home layout and mix page, owner picks | sonnet | none (gallery only) |
| 2 | Catalog: `player.py genres`, `lib/mixes/catalog.ts`, `/api/mixes/catalog`, genre chart row, `/genre/[slug]` in the picked design | opus | "Genre charts: Pop, Rock, Metal, EDM and more, updated daily" |
| 3 | No-call mixes: `mixes` collection, On repeat, Back again, Friends mix, Popular on this server, `/mix/[id]` | sonnet | "Your mixes: On repeat, Back again and a Friends mix" |
| 4 | Seeded mixes: `player.py mixes`, nightly job, Daily Mix, genre mixes, New to you, artist mixes, artist tagging | opus | "Daily Mix, genre mixes and New to you, built overnight from what you play" |
| 5 | Genres, Moods, Decades rows and Mood of the day; last.fm fallback behind an env key | sonnet | "Browse by genre, mood and decade" |

## Decisions for the owner

1. Ship the last.fm tag fallback behind `LASTFM_API_KEY`? Recommended: yes, off by default, it only widens genre tagging.
2. Friends mix and Popular on this server use only `share_listening` members? Recommended: yes, same rule as the listening bar.
3. Cap the Home "Your mixes" row at 8 tiles with a Show all? Recommended: yes, no-call mixes first.
