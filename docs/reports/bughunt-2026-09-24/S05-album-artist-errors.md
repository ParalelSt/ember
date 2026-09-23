# S05. Album and artist errors showed a wall of raw data, and a missing album was a "server error"

**What you'd notice:** opening an album or artist page that YouTube Music couldn't load showed (or logged in the browser) a 1 KB blob of internal YouTube data instead of a sentence. A link to an album that doesn't exist said "server error" (502) instead of "not found" (404).

**Why it happened:** when the YouTube Music library fails, its error message includes the whole reply it was trying to read. The helper passed that message straight to the app, which passed it straight to the browser, always as a 502.

**What changed:** the helper now keeps the full detail for the server log only and answers with a short sentence plus a reason: "not-found" when YouTube Music returned no page at all for that id (or a real HTTP 404), otherwise "failed". The app turns "not-found" into a 404 ("Album not found" / "Artist not found") and anything else into a 502 with a short "Couldn't load this album..." message. Files: `player.py` (cmd_album, cmd_artist, new `_browse_error`), `apps/web/lib/sources/youtube.ts` (getAlbum, getArtist, new `browseError`), tests in `tests/test_player_browse.py` (new) and `apps/web/lib/sources/youtube.test.ts`.

**Compare:** before = `084c1f377ca3cf5f56a925161b82f20c4b6c2652`, after = `5553b2bc31d7d23cf7a28de6e8b3e16fdde74376`.
- Test: `.venv/bin/python -m unittest tests/test_player_browse.py` (uses the real error from a live `player.py album -- MPREb_zzzzzzzzzzz`): before, all 4 fail (`AssertionError: 1018 not less than 120`, `KeyError: 'reason'`); after, all 4 pass.
- Test: `cd apps/web && npx vitest run lib/sources/youtube.test.ts`: before, 3 fail (`expected 502 to be 404`, `expected '"Unable to find 'contents' using pa…' not to contain 'responseContext'`); after, all 13 pass.
- Try it yourself: open `/album/MPREb_zzzzzzzzzzz` on the sandbox; the request to `/api/youtube/album/MPREb_zzzzzzzzzzz` now answers 404 "Album not found".

**Risk:** low. Working albums and artists are untouched; only the error path changed. A future YouTube layout change still reads as "failed" (502), not "not found".
