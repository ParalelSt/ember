# Mix measurement

Rebuilds every member's mixes from a copy of a PocketBase database with the
real mix job (`apps/web/lib/mixes/job.ts`), once on the old rules and once on
the new ones, and says what moved. Used before shipping a change to how mixes
are filled (the Game & Anime mix was the first).

Nothing here touches a running PocketBase, the app ports, or the live data.

## 1. Copy and export

```sh
tests/measure-mixes/snapshot.sh <pb_data dir | data.db> <out dir> [charts.json]
```

`sqlite3 -readonly ... .backup` makes the copy (safe on a running
PocketBase), then the script exports what the job reads as JSON:
`plays.json`, `likes.json`, `blocked.json`, `artist_genres.json`,
`mixes.json`, `unavailable.json`, `members.json` (ids only) and `meta.json`
(`now` = the newest play, so every run builds the same day). It refuses an
out dir inside a `pb_data` dir and the main checkout's live `pb_data` unless
`--yes-live` is given. Keep the out dir outside the repo: it is members'
listening data.

## 2. Run

From `apps/web`:

```sh
MIX_SIM_DIR=<out dir> MIX_SIM_LABEL=baseline MIX_SIM_FETCH=1 MIX_SIM_LOOKUPS=1 \
  PYTHON_BIN=<repo venv python> \
  ../../node_modules/.bin/vitest run --config ../../tests/measure-mixes/vitest.config.mts
```

- `MIX_SIM_FETCH=1` fetches each seed's radio once (anonymous YouTube Music,
  `player.py radio-batch`) and caches it in `<out dir>/radios.json`. Without
  it, only cached radios are used; a missing one is listed as `radioMissing`.
- `MIX_SIM_LOOKUPS=1` looks up artists the copy lacks (MusicBrainz, Last.fm
  when `LASTFM_API_KEY` is set), paced like the app. Results go to
  `<out dir>/tags-overlay.json`, never into the copy. A row the simulated
  tagger wrote is classified again by the code under test, so old and new
  rules each read the same lookups their own way.
- `MIX_SIM_ONLY=id1,id2` builds only those members.

Writes `<out dir>/runs/<label>.json` (per member: the mixes, every song with
an explanation, the style plans, the families of the member's own songs,
their own songs no rule places, the job's notes such as out-of-place seeds)
and `runs/stored.json` (the mixes as the copy holds them, no rebuild).

"Old rules" is this same run on the old commit. The per-song explanations
(`signal`, `resolved`, `via`, `home`) appear when the code under test has
those functions.

Order: record on the old commit with both flags, run it again without them
(the replay is the baseline), switch to the new commit, record, replay.

## 3. Compare

```sh
node tests/measure-mixes/diff.mjs <a.json> <b.json> [summary.txt]
```

Per member: mixes that appeared or disappeared, per mix the song count
before and after, every song that moved out (and to which mix, or nowhere)
or came in (and from which mix, or new), radio songs by artists with no
family, songs with a title signal outside Game & Anime (FLAGGED, must be 0),
and own songs no rule places. The comparison is
`apps/web/lib/mixes/sim/diff.ts`; the harness checks itself on
`fixture/` in `lib/mixes/sim/selfcheck.test.ts` (normal suite, offline).
