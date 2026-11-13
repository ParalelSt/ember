# Genre charts and your mixes

As built for 0.7.31 (plan: `docs/superpowers/plans/2026-10-15-genre-charts-and-mixes.md`, which superseded the 2026-09-20 version of this file). Two features on Home:

1. **Charts by genre**: YouTube Music's US genre charts plus a Balkan chart, per server, refreshed daily. "Popular now" (the blended daily chart, `docs/trending.md`) stays its own row.
2. **Your mixes**: per member, up to twelve mixes of five kinds (style, Discover, On repeat, artist, Throwback; "More mixes", 2026-11-13), rebuilt nightly (Discover weekly). A Rock & Metal mix never gets pop.

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

- **Taxonomy** (`lib/genres/taxonomy.ts`): nine families, each with sub-genres (the style mixes):

  | Family | Sub-genres (slug) |
  |---|---|
  | Rock & Metal | Metal `metal`, Punk `punk`, Indie `indie`, Rock `rock` |
  | Pop | K-Pop `kpop`, Indie Pop `indie-pop` |
  | Hip-hop & R&B | Hip-hop `hiphop`, R&B `rnb` |
  | Electronic | Drum & Bass `dnb`, Techno `techno`, House `house`, Chill Electronic `ambient` |
  | Latin | Reggaeton `reggaeton`, Salsa & Bachata `tropical` |
  | Balkan | Balkan Rap `balkan-hiphop`, Ex-YU Rock `balkan-rock`, Narodna `turbofolk`, Balkan Pop `balkan-pop` |
  | Country & Folk | Country `country`, Folk `folk` |
  | Jazz & Blues | Blues `blues`, Jazz `jazz` |
  | Classical | Soundtracks `soundtrack` |

  Raw tags map to a family by exact name, then by keyword (Balkan words first, so "serbian rap" is Balkan; metal before rock and folk). Noise tags (seen live, decades, other countries) map nowhere. Primary family = the heaviest; a secondary is kept at 60% of it or more. The sub-genre (`subOfTags`) is the heaviest of the family's sub-genres over **all** the artist's tags, each tag counting for the first sub-genre whose pattern it matches (so a Balkan band tagged "serbian" and "rock" is Ex-YU Rock). The mix build reads it again from the stored tags of every looked-up artist, so a sub-genre added here applies without new lookups; chart priors and manual rows keep their stored one.
- **Tagger** (`lib/genres/tagger.ts`, wired in `lib/genres/instance.ts`): Last.fm `artist.getTopTags` when `LASTFM_API_KEY` is set (4 a second), MusicBrainz search + `inc=genres+tags` otherwise or as Last.fm's fallback (1 a second, `MUSICBRAINZ_CONTACT` in the User-Agent). One lookup per artist at a time, in-flight lookups shared. `found` rows are refreshed after 180 days, `none` retried after 30; a source fault writes nothing. `GENRES_LOOKUP_DISABLED=1` turns lookups off.
- **Chart priors**: an artist with no row who is in a genre chart gets that chart's family (`source: chart`). A lookup that finds them replaces it; one that finds nothing keeps it for a month.
- **Manual**: `PATCH /api/admin/artist-genres/[artist]` `{ family, sub? }` (or `family: null`, no family), admin only, never replaced by a lookup. `GET` the same path to read a row.

## Mixes

Pure engine in `lib/mixes/` (`score.ts`, `cluster.ts`, `build.ts`, `artist.ts`, `discover.ts`, `history.ts`, `kinds.ts`), orchestrated by `lib/mixes/job.ts`.

### The five kinds

| Kind | Key | Card label / title | Songs |
|---|---|---|---|
| Style | family or sub-genre slug (`rock-metal`, `metal`, `turbofolk`) | MIX / "Metal" | The member's songs in the style, then the radio of 4 of them and the family's charts, purity-checked (below) |
| Discover | `discover` | DISCOVER / "New to you" | Songs never played (in the last 365 days) or liked, from the radio of the best song of 5 of the member's top 10 artists; artists new to the member first, their known artists' unheard songs only fill up; 2 per artist, 30 songs. Rebuilt weekly |
| On repeat | `on-repeat` | ON REPEAT / "Your top songs" | Songs played 2+ times in the last 30 days, most played first, 30 songs |
| Artist | `artist-<slug>` (`artist-gojira`, a hash for a name with no Latin letters) | ARTIST MIX / "Gojira" | The artist's songs the member plays (10), then the radio of 3 of them: more by the artist (12 in all) and similar artists (3 each). A similar artist tagged with another family than the featured one is dropped; untagged ones are kept |
| Throwback | `throwback` | THROWBACK / "Back again" | Songs not played in the last 60 days that were played 3+ times before (a liked song: once), within 365 days; a like counts 2 plays; 30 songs |

The kind is read from the key (`mixKind`), so the `mixes` collection has no new field and old rows still read as style mixes.

### Caps and order

At most **12** on Home (`MAX_MIXES`). Base caps: 5 style, 1 Discover, 1 On repeat, 4 artist, 1 Throwback (that is 12). When a kind has fewer, the free slots go to more style mixes (up to 7), then more artist mixes (up to 6), so a member with two styles still gets a full row while twelve artist mixes can never crowd out the rest (`lib/mixes/kinds.ts` `KIND_CAPS`, `lineup`).

Home order: style mixes, Discover, On repeat, artist mixes, Throwback. Stored positions are banded by kind (style 0-9, Discover 10, On repeat 20, artist 30-39, Throwback 40) so a Discover row kept from earlier in the week sorts into place.

Style mixes come family-first: every family's heaviest mix before any family's second, so one family's sub-genres never push a second family out.

### The build, per member

1. **Score** the last 90 days of plays, `exp(-ageDays/30)` per play, +2 per like; artists sum their songs. Plays are loaded for 365 days (Throwback and Discover's "never played" read them).
2. **Tag** the top 60 artists (at most 100 lookups per member per run, shared with step 6).
3. **Style mixes** (`cluster.ts`): the member needs a total of 10. A family or sub-genre needs weight 4, 3 songs and 2 artists. Per family: no qualifying sub-genre, the family mix; one, the family mix plus that sub-genre when it is at most 80% of the family; two or more, each of them plus the family mix when the songs outside them still qualify (otherwise songs with no known sub-genre join the heaviest one, the old halves rule).
4. **Artist mixes** (`artist.ts`): artists with 3+ different songs, weight 3+ and a YouTube song, best first. Need the same member total of 10, as does Discover.
5. **On repeat and Throwback** (`history.ts`): no radio; need 10 songs each, 5 per artist.
6. **Seeds and radio**: style 4 of its top 10 songs, artist 3 of theirs (both shuffled by date and key), Discover 5 artists shuffled by week. `player.py radio-batch --seeds=... --limit 30`, one call per mix on the bulk lane (3 s pacing, partial failure tolerated), and each seed's radio fetched once per build (an artist mix and Discover often share one).
7. **Tag** the radio's new artists.
8. **Assemble** a style mix: up to 20 of the member's own songs (3 per artist), then new songs round robin over the radios, then the family's chart(s) as filler. A new song is taken only when its artist's primary family is the mix's (and the sub-genre, for a sub-genre mix). An untagged artist is kept only when 2+ of the mix's seed radios brought them and no other family's chart lists them; an admin's "no family" never. Woven like radio (2 known first, then 1 known in 3), 50 songs (artist mixes too, Discover 30); fewer than 20 and a radio mix is not written.
9. Every kind drops dead songs (`unavailable_tracks`), the member's **blocked songs** (`blocked_tracks`, also filtered again when read) and other versions of a song already in.
10. **Store** in `mixes` (`ensure_mixes.pb.js`: list/view own rows only, writes admin only, unique per member and key, deleted with the member): one row per mix with track snapshots, seeds and the card's cover. Rows that are no longer in the lineup are deleted; a mix whose radio failed (a YouTube outage) or came out short keeps its last row. Discover built this week (local Monday to Sunday) is kept as it is.

**When**: nightly at `MIXES_HOUR` (default 4) for every member with a play in 90 days, from `instrumentation.ts` (a minute tick and a `MUSIC_DIR/mixes-YYYY-MM-DD.built` marker, `lib/mixes/schedule.ts`), and lazily from `GET /api/mixes` when the member has none or one is older than 36 h (Discover: 8 days), not again for 6 h after a build that made nothing. One build at a time per process. `MIXES_DISABLED=1` turns both off.

**API**: `GET /api/mixes` `{ eligible, building, mixes: [{ key, kind, title, subtitle, cover, builtAt, count }] }` (at most 12, blocked and dead songs not counted), `GET /api/mixes/[key]` `{ key, kind, title, subtitle, cover, builtAt, tracks }` (404 for anyone else's), both read through the member's own client.

**UI** (owner's picks, 2026-10-15, extended 2026-11-13): "Your mixes" is the first Home row (order B), up to 12 Spotify Radio cards (`components/mixes/MixCard.tsx`): the mix's light colour, a label top right, three covers, the title big bottom left, the artists in muted text under it, 172px on a phone. Per kind:

| Kind | Label | Colour | Covers |
|---|---|---|---|
| Style | MIX | the genre's tint | three round faces, the top artist big in the middle |
| Artist | ARTIST MIX | the artist's family tint (a family tint picked by key when unknown) | the artist big and round, two similar artists small in front of it |
| Discover | DISCOVER | fresh green `#c9f0a8` | three square covers fanned out |
| On repeat | ON REPEAT | warm orange `#ffc9a3` | three square covers stacked, the most played on top |
| Throwback | THROWBACK | old paper `#e6d9bf` | the style faces in sepia |

The top two mixes take quick grid slots after Liked songs (and a live carlist). The Mixes chip keeps that row only. `/mix/[key]`: eyebrow per kind (Mix, Artist mix, Discover, On repeat, Throwback), title "Metal Mix", "Gojira Mix", "New to you"; "Rebuilt every night" or "New every Monday"; "Built today from Gojira, Tool, Metallica", Play, Shuffle, Save as playlist. Home polls every 15 s while a first build runs.

**Cost**: charts about 11 YouTube calls a day; a member at most about 7 style x 4 + 6 artist x 3 + 5 Discover seeds, fewer with shared seeds (worst case about 2.5 min at 3 s pacing, typically 5 style + 4 artist about 1.7 min), plus a handful of new-artist lookups.

## Tests

- `tests/test_player_genre_charts.py`: picker on saved `get_charts('US')`, pacing, partial and total failure, radio-batch (saved responses in `tests/fixtures/genre-charts/`, captured 2026-10-16).
- vitest: `lib/charts.test.ts`, `lib/genres/*.test.ts` (Last.fm and MusicBrainz on saved answers in `tests/fixtures/genres/`), `lib/mixes/*.test.ts` (including `purity.test.ts`: 30 simulated days, 70% rock, 30% pop, leaky radios, zero cross-family songs; `kinds`, `artist`, `discover`, `history` for the other kinds and the lineup; `job.test.ts` builds every kind end to end on a fake player), the route tests, Home, the chart and mix pages.
- `tests/pb-genres.test.mjs`: both collections' rules on a throwaway PocketBase.
- Browser sims (need a build and a sandbox PocketBase): `tests/charts-ui.test.mjs`, `tests/mixes-ui.test.mjs`. Fake player: `genre-charts` (`FAKE_FAIL_GENRE_CHARTS=1`, `FAKE_GENRE_CHARTS_FIXTURE`), `radio-batch` (`FAKE_FAIL_RADIO_BATCH=1`, `FAKE_RADIO_FIXTURE`).

## Later

YouTube's mood and genre category playlists (R&B alone, K-Pop, Classical) need a raw browse parser in ytmusicapi 1.12.2. Mixes in the Android Auto browse tree. An admin page for genre overrides (the route exists).
