# S02. One odd search result stalled a playlist import

**What you'd notice:** a Spotify or YouTube playlist import stuck on "YouTube Music is busy", backing off and retrying the same few songs until it gave up, even though YouTube Music was fine.

**Why it happened:** when searching for a song, any error at all was treated as "YouTube Music is busy, try the batch again". But if the search library itself crashes on a result it doesn't understand, retrying gives the exact same crash every time, so the import could never get past that song.

**What changed:** only real "busy or network" failures (HTTP 429/5xx, timeouts, dropped connections, a garbled reply) still ask for a retry. A crash inside the search library now counts as "no match found" for that one song, and the import moves on. Files: `player.py` (cmd_match, new `_search_retryable`), `tests/test_player_match.py` (2 new tests).

**Compare:** before = `b3eb8d548bf30748d361c902b45b6af4c4bcd8c1`, after = `05bec400de492ba9f0711b8e6c9e64ca87f49990`.
- Test: `.venv/bin/python -m unittest tests/test_player_match.py`: before, `test_parser_crash_is_not_found_not_failed` fails with `AssertionError: Lists differ: [1, 2] != []` (both crashes marked "retry"); after, all 11 pass, including a check that 503, 429, timeouts, connection errors and garbled replies still retry.
- Screenshots: not visual.
- Try it yourself: needs YouTube Music to return a result shape ytmusicapi can't parse, which can't be triggered on demand.

**Risk:** low. Busy and network errors behave exactly as before; the only change is that a library crash now means "not found" for one song instead of blocking the whole import.
