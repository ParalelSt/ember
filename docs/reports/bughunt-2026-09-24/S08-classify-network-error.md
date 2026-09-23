# S08. A liked song could be marked "not music" just because YouTube Music was briefly unreachable

**What you'd notice:** during a Google likes transfer, a real song could quietly go missing from the results, with nothing on screen explaining why.

**Why it happened:** while asking YouTube Music what type of video each liked song is, a plain network hiccup or a 5xx server error was treated the same as "this isn't a song": the like was dropped for good instead of being tried again.

**What changed:** a network failure or server error during that check now tells the transfer "YouTube Music is busy", so it backs off and retries the batch, same as it already did for a rate-limit response. Only a real per-video failure still counts as "not music". Files: `player.py` (cmd_classify), `tests/test_player_classify.py` (2 new tests).

**Compare:** before = `a7f03c9`, after = `1dc1a90`.
- Test: `.venv/bin/python -m unittest tests/test_player_classify.py`: before, `test_network_error_stops_the_batch_and_says_busy` and `test_server_error_stops_the_batch_and_says_busy` fail with `AssertionError: False is not True`; after, all 10 pass.
- Screenshots: not visual.
- Try it yourself: needs YouTube Music to actually drop a connection mid-transfer, which can't be triggered on demand.

**Risk:** low. Rate-limit handling is unchanged; this only widens what counts as "try again" to cover network and server errors, matching how the search step already behaves.
