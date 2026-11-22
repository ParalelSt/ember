# New releases

A "New releases" row on Home: albums, EPs and singles that came out recently
from the artists a member likes, plus a few from the genres they play. Built
2026-11-22 from the owner's picker (`home_row` for the place, `liked_plus` for
the content). The row sits between "Because you played" and "Popular now", it
shows under the All chip only, and it is not on the page at all when there is
nothing new.

## The shape of it

Scanning and the cache are **server wide, keyed by artist**: an artist's page
is the same for everyone, so two members who like the same band cost one call,
and the calls per day are fixed by constants, not by how many members there
are. The row is **chosen per member at request time**, by pure functions over
that member's likes. No per-member file, no new PocketBase collection, and a
like counts on the next Home load.

```
Home row  <- GET /api/new-releases  <- selectForMember(ledger, this member's likes + genres)
                                        ^
          the ledger comes from the server-wide cache, which runs
          player.py new-releases once a day in the background
```

## What counts as new

YouTube gives a year at best, never a date, so "new" is measured from the
first time this server saw a release: 42 days (`NEW_WINDOW_DAYS`) from
`firstSeenAt`. Three rules set it:

1. **The explore shelf.** The first run in which the release is on YouTube's
   "New albums & singles" list. No year needed.
2. **An artist page, any scan after the first.** A `browseId` that was not in
   that artist's known list, whose year is not older than the year 42 days
   ago. No year passes: turning up since the last scan is the evidence.
3. **An artist page, the first scan.** Nothing is new. Everything is recorded
   as the artist's baseline, because a year cannot tell January from November.
   The exception is the first 42 days of a year, when the year alone proves it.

A release is new once. When it ages out its id goes to `retired` (the last
500), so neither source can bring it back. The practical cost: in the first
days after this ships the row leans on suggestions, and a liked artist's own
releases start to appear from that artist's second scan.

## Who gets what

- **Liked artists**: the member's likes where the track is from YouTube and
  has a valid artist id, grouped by artist. One liked song is enough.
- **Watchlist (what is scanned)**: each member's liked artists by like count
  then recency, members taken in turn, capped at 60.
- **The member's genres**: the top 3 families among their liked artists, from
  `artist_genres` read with `maxLookups: 0`, dropping any under 10%.
- **Suggestions**: a new release whose artist the member has not liked and
  whose family is one of their genres. Candidates come from other members'
  liked artists (free), the explore shelf (1 call), and the top 8 artists of
  each relevant cached genre chart (up to 30 artists, no chart call).
- **The row**: up to 12 liked-artist releases (2 per artist), then up to 8
  suggestions (1 per artist). When both groups have something, the row gets an
  All / Your artists / Similar switch, which starts on All and is not
  remembered.

## The daily run

One run is one `player.py new-releases` process on the bulk lane: the explore
shelf, then up to 18 artists (12 liked, 6 genre, least recently checked
first), `get_artist` only and never the artist page's song search. At most 19
YouTube calls a day, 3 s apart, about a minute. Every watched artist is seen
every 5 days.

- 24 h TTL, 5 min retry, one run at a time, memory plus the mirror
  `MUSIC_DIR/new-releases.json`.
- **A read never waits and never fetches.** It answers from memory and may
  start the run behind it. A cold start answers an empty list; the charts
  cache waits on a cold start, this one cannot, because a run takes a minute.
- **Never two paced runs together.** The run asks the charts cache whether it
  is refreshing (`chartsCache().busy()`) and steps aside if it is.
- A failed artist keeps its known list and still has its `checkedAt` moved on,
  so one dead channel cannot block the queue. A whole failed run changes
  nothing and keeps serving what it had, marked stale.
- After each run the new releases' artists are tagged for their family, at
  most 25 lookups, which go to Last.fm and MusicBrainz, never to YouTube.
- `NEW_RELEASES_DISABLED=1` turns the run off and the route answers empty.

## Where the code is

| Part | File |
|---|---|
| The player bridge | `player.py` (`cmd_new_releases`, `fetch_new_releases`, `release_json`) |
| Fetch and parse | `apps/web/lib/sources/youtube.ts` (`fetchNewReleases`, `parseNewReleases`) |
| The rules, all pure | `apps/web/lib/newReleases/rules.ts` |
| The cache and the run | `apps/web/lib/newReleases/cache.ts`, `instance.ts` |
| The payload types | `apps/web/lib/newReleasesView.ts` |
| The route | `apps/web/app/api/new-releases/route.ts` |
| The row | `apps/web/components/home/NewReleasesRow.tsx` |
| The place on Home | `apps/web/lib/home.ts` (`'releases'` in `PHONE_ORDER`) |

Tests live beside each of those, plus `tests/test_player_new_releases.py` for
the player side. Nothing here needs a PocketBase schema change.

## Left for later

A full "New releases" page, hiding a release once the member has liked a song
from it, exact release dates for baseline candidates, and the row in the
Android Auto tree.
