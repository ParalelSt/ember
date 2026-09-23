# S03. A brief search outage showed "no results" for 5 minutes

**What you'd notice:** a search that should find plenty came back empty, and kept coming back empty for about 5 minutes even after YouTube Music recovered.

**Why it happened:** search asks YouTube Music for songs and videos at the same time, then plain YouTube as a last resort. When all of them failed (say, the network dropped), the helper still answered "nothing found", and the app remembered that answer for 5 minutes. Also, a network error on the songs half made the helper throw away the videos half without even reading it.

**What changed:** a network failure on the songs half no longer skips the videos half. If nothing is found and any part of the search could not be reached, the helper now reports an error instead of an empty list, so the app shows a failure and the next search tries again. The app also never caches an empty answer. A query that simply crashes YouTube Music's parser still falls back to plain YouTube as before. Files: `player.py` (cmd_search), `apps/web/lib/sources/youtube.ts` (searchTracks), tests in `tests/test_player_search.py` (new) and `apps/web/lib/sources/youtube.test.ts`.

**Compare:** before = `578872dd7325d86640589e1a3721358bf235d8f8`, after = `7e64d170a4b15a4aa3bbfee07d84040a06a695a7`.
- Test: `.venv/bin/python -m unittest tests/test_player_search.py`: before, 3 of 7 fail (`Lists differ: [] != ['bbbbbbbbbbb']` for the skipped videos; `AssertionError: 0 == 0` for both outage cases answering "no results"); after, all 7 pass.
- Test: `cd apps/web && npx vitest run lib/sources/youtube.test.ts`: before, `does not cache an empty answer` fails (`expected "vi.fn()" to be called 2 times, but got 1 times`); after, all 10 pass.
- Also checked: one live `player.py search -- "daft punk one more time"` still returns results.
- Try it yourself: turn off the server's network, search once (you now get an error, not "no results"), turn it back on and search again: results appear right away.

**Risk:** low. Normal searches are unchanged; the only new behaviour is an error instead of an empty list during an outage, and genuinely empty searches are re-asked instead of cached.
