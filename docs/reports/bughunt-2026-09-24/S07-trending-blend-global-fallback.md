# S07. Trending blend could count the global chart twice under different countries

**What you'd notice:** a "Trending blend" of several countries could look off: one country's chart quietly turning out to be the exact same global chart as another country, making some songs rank higher than they should.

**Why it happened:** when a specific country's own daily chart couldn't be found, the code quietly substituted the global chart and reported it as if it were that country's chart. When blending several countries, if two of them hit this at once, the same global chart got scored twice, once under each country's name, tilting the blend toward it.

**What changed:** blending more than one country no longer allows that substitution: a country with no chart of its own is now skipped, the same as any other failed country. A single country's trending still falls back to the global chart when needed, since there is nothing else to blend it against. Files: `player.py` (chart_tracks, fetch_country_charts, cmd_trending), `tests/test_player_trending.py` (4 new tests, existing stubs updated for the new parameter).

**Compare:** before = `6cf95ad`, after = `37dd04f`.
- Test: `.venv/bin/python -m unittest tests/test_player_trending.py`: before, 4 tests fail/error, including `test_blend_of_several_countries_does_not_allow_the_global_substitute` (`AssertionError: Lists differ: [('US', True), ...] != [('US', False), ...]`); after, all 26 pass.
- Screenshots: not visual.
- Try it yourself: request the trending blend for two countries where one has no chart of its own (needs a live YouTube Music outage for that country to trigger on demand).

**Risk:** low. Single-country trending is unchanged; this only tightens what a multi-country blend accepts as "this country's chart".
