# T3. Playlist import via yt-dlp could fail to find ffmpeg

**What you'd notice:** importing tracks through the yt-dlp playlist fallback
(used when ytmusicapi's own playlist reader fails) could break on a machine
where ffmpeg is not on PATH, even though every other import path works fine.

**Why it happened:** `player.py` builds yt-dlp's options in six places; four
of them pass both the cookie options and the ffmpeg location, but the two
playlist-listing functions (`ytdlp_playlist` and `_ytdlp_playlist`) only
passed the cookie options, so yt-dlp fell back to searching PATH for ffmpeg
instead of using Ember's bundled one.

**What changed:** added `**_ffmpeg_opts()` to both option dicts, matching
the other four call sites. File: `player.py`.

**Compare:** before = `708a28d`, after = `c93ebe7`.
- Test: `.venv/bin/python -m unittest tests.test_ffmpeg_path -v`: before,
  `AssertionError: 6 != 4` (6 `_cookie_opts()` calls, only 4 `_ffmpeg_opts()`
  calls); after, `Ran 9 tests ... OK`.
- Test: `node tests/ffmpeg-resolve.test.mjs`: before 8/9 (this same check
  failing); after 9/9.
- Screenshots: not visual.
- Try it yourself: needs a machine with no ffmpeg on PATH and yt-dlp's flat
  playlist fallback triggered; the unit tests above are the reliable check.

**Risk:** low, additive option only (matches four existing call sites).
