# Genre charts and your mixes

As built for 0.7.31 (plan: `docs/superpowers/plans/2026-10-15-genre-charts-and-mixes.md`, which superseded the 2026-09-20 version of this file). Two features on Home:

1. **Charts by genre**: YouTube Music's US genre charts plus a Balkan chart, per server, refreshed daily. "Popular now" (the blended daily chart, `docs/trending.md`) stays its own row.
2. **Your mixes**: per member, one mix per genre family they play (Spotify Daily Mix style), rebuilt nightly. A Rock & Metal mix never gets pop.

## Charts

| Piece | Where |
|---|---|
| Fetch | `player.py genre-charts`: `get_charts('US')['genres']` (8 charts), one `get_playlist` each, then Serbia's daily chart as `balkan` (never the global chart in its place). 3 s between calls (`CHART_FETCH_PACING_SEC`), a failing chart is skipped and named in `failed`, exit 1 only when nothing came back. Slugs: `hard-rock-metal`, `rock`, `jazz`, `country`, `pop`, `hip-hop`, `latin`, `dance-electronic`, `balkan` |
| Cache | `lib/charts.ts` `createChartsCache`: keyed by slug, 24 h TTL, stale-while-revalidate, 5 min retry after a failed run, mirror `MUSIC_DIR/charts.json`. A chart that fails keeps its last good list (marked stale once past the TTL); the run's own time decides the next refresh, so one bad chart does not hammer YouTube |
| API | `GET /api/charts` (tiles: `popular` + `genres[]`, no track lists), `GET /api/charts/[slug]` (`popular` proxies the trending cache). Dead songs dropped. Behind sign-in |
| UI | Home row "Charts by genre" (`components/charts/ChartTile.tsx`: chart colour, name, "Top 50", two tilted covers), page `/chart/[slug]` (ranked list, Play, Shuffle, Save as playlist, "Updated daily" or "Updated 3 hours ago" when stale) |
| Order and colours | `lib/genres/taxonomy.ts` `CHARTS`: Balkan first, then the US charts |

After each good run the chart artists become weak genre priors (below).

## Genres

Genres belong to **artists**, not songs: `artist_genres` (PocketBase, admin only, `ensure_artist_genres.pb.js`), keyed by `lib/genres/artistKey.ts` (the lead artist, normalized like `songKey`).

- **Taxonomy** (`lib/genres/taxonomy.ts`): nine families, `rock-metal` (halves `rock`, `metal`), `pop`, `hiphop-rnb` (halves `hiphop`, `rnb`), `electronic`, `latin`, `balkan`, `country-folk`, `jazz-blues`, `classical`. Raw tags map by exact name, then by keyword (Balkan words first, so "serbian rap" is Balkan; metal before rock and folk). Noise tags (seen live, decades, other countries) map nowhere. Primary family = the heaviest; a secondary is kept at 60% of it or more.
- **Tagger** (`lib/genres/tagger.ts`, wired in `lib/genres/instance.ts`): Last.fm `artist.getTopTags` when `LASTFM_API_KEY` is set (4 a second), MusicBrainz search + `inc=genres+tags` otherwise or as Last.fm's fallback (1 a second, `MUSICBRAINZ_CONTACT` in the User-Agent). One lookup per artist at a time, in-flight lookups shared. `found` rows are refreshed after 180 days, `none` retried after 30; a source fault writes nothing. `GENRES_LOOKUP_DISABLED=1` turns lookups off.
- **Chart priors**: an artist with no row who is in a genre chart gets that chart's family (`source: chart`). A lookup that finds them replaces it; one that finds nothing keeps it for a month.
- **Manual**: `PATCH /api/admin/artist-genres/[artist]` `{ family, sub? }` (or `family: null`, no family), admin only, never replaced by a lookup. `GET` the same path to read a row.

## Mixes

Pure engine in `lib/mixes/` (`score.ts`, `cluster.ts`, `build.ts`), orchestrated by `lib/mixes/job.ts`:

1. **Score** the last 90 days of plays, `exp(-ageDays/30)` per play, +2 per like; artists sum their songs.
2. **Tag** the top 60 artists (at most 100 lookups per member per run, shared with step 5).
3. **Cluster**: the member needs a total of 15; a family needs weight 6, 3 songs and 2 artists. Rock & Metal (and Hip-hop & R&B) split into their halves only when both halves pass on their own; artists with no known half join the heavier one. At most 6 mixes, heaviest first.
4. **Seeds**: 4 of the family's top 10 songs, shuffled by date and mix key (same all day, different tomorrow). `player.py radio-batch --seeds=a,b,c,d --limit 30` per mix on the bulk lane (3 s pacing, partial failure tolerated).
5. **Tag** the radio's new artists.
6. **Assemble**: up to 20 of the member's own songs (3 per artist), then new songs round robin over the radios, then the family's chart(s) as filler. A new song is taken only when its artist's primary family is the mix's (and the half, for a split mix). An untagged artist is kept only when 2+ of the mix's seed radios brought them and no other family's chart lists them; an admin's "no family" never. Dead songs, other versions of a song already in, and a 4th song by one artist are dropped. Woven like radio (2 known first, then 1 known in 3), 50 songs, fewer than 20 and the mix is not written.
7. **Store** in `mixes` (`ensure_mixes.pb.js`: list/view own rows only, writes admin only, unique per member and key, deleted with the member): one row per mix with track snapshots, seeds and the card's cover. Rows for families no longer eligible are deleted; a mix whose radio failed (a YouTube outage) or came out short keeps its last row.

**When**: nightly at `MIXES_HOUR` (default 4) for every member with a play in 90 days, from `instrumentation.ts` (a minute tick and a `MUSIC_DIR/mixes-YYYY-MM-DD.built` marker, `lib/mixes/schedule.ts`), and lazily from `GET /api/mixes` when the member has none or they are older than 36 h (not again for 6 h after a build that made nothing). One build at a time per process. `MIXES_DISABLED=1` turns both off.

**API**: `GET /api/mixes` `{ eligible, building, mixes: [{ key, title, subtitle, cover, builtAt, count }] }`, `GET /api/mixes/[key]` (404 for anyone else's), both read through the member's own client.

**UI** (owner's picks, 2026-10-15): "Your mixes" is the first Home row (order B), Spotify Radio cards (`components/mixes/MixCard.tsx`: the mix's light colour, MIX label, three overlapping round faces of its top artists, the name without "Mix", the artists in muted text under it, 172px on a phone). The top two mixes take quick grid slots after Liked songs (and a live carlist). The Mixes chip keeps that row only. `/mix/[key]`: "Built today from Gojira, Tool, Metallica", Play, Shuffle, Save as playlist. Home polls every 15 s while a first build runs.

**Cost**: charts about 11 YouTube calls a day; a member about 6 mixes x 4 seeds (about 75 s at 3 s pacing) plus a handful of new-artist lookups.

## Tests

- `tests/test_player_genre_charts.py`: picker on saved `get_charts('US')`, pacing, partial and total failure, radio-batch (saved responses in `tests/fixtures/genre-charts/`, captured 2026-10-16).
- vitest: `lib/charts.test.ts`, `lib/genres/*.test.ts` (Last.fm and MusicBrainz on saved answers in `tests/fixtures/genres/`), `lib/mixes/*.test.ts` (including `purity.test.ts`: 30 simulated days, 70% rock, 30% pop, leaky radios, zero cross-family songs), the route tests, Home, the chart and mix pages.
- `tests/pb-genres.test.mjs`: both collections' rules on a throwaway PocketBase.
- Browser sims (need a build and a sandbox PocketBase): `tests/charts-ui.test.mjs`, `tests/mixes-ui.test.mjs`. Fake player: `genre-charts` (`FAKE_FAIL_GENRE_CHARTS=1`, `FAKE_GENRE_CHARTS_FIXTURE`), `radio-batch` (`FAKE_FAIL_RADIO_BATCH=1`, `FAKE_RADIO_FIXTURE`).

## Later

YouTube's mood and genre category playlists (R&B alone, K-Pop, Classical) need a raw browse parser in ytmusicapi 1.12.2. Mixes in the Android Auto browse tree. An admin page for genre overrides (the route exists).
