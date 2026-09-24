# Songsterr: a song with a Japanese title

Saved from songsterr.com on 2026-09-24 for the import bug where some songs
never imported: "黄泉より聴こゆ、皇国の燈と焔の少女" by Imperial Circus Dead
Decadence. Metadata only, no notes.

- `search.json`: the answer to
  `/api/songs?pattern=Imperial Circus Dead Decadence 黄泉より聴こゆ、皇国の燈と焔の少女`,
  exactly as served (Ember's own query for the song).
- `song.html`: the song page of the top hit (songId 460015) cut down to its
  `<script id="state">` with `route` and `meta.current` (ids, revision,
  image, tracks, titles). Songsterr titles it
  "黄泉より聴こゆ、皇国の燈と焔の少女 / Yomi Yori Kikoyu, Kokoku no Tou to Honoo no Shoujo".

The part files a test serves for this song are the invented ones in
`../songsterr/` (the notes are Songsterr's licensed content, so none are
kept here).

Root cause: title matching kept only `[a-z0-9]` words, so a title in
Japanese had no words and no hit could ever match (`lib/tabFetch/ug.ts`
`words`, `sameSong`).
