"""player.py `search`: songs and videos searched in parallel, yt-dlp as the
last resort. A search that could not ask anyone must fail, not answer "no
results": the web app caches an answer for 5 minutes. No network: YTMusic
and yt-dlp are replaced.

    .venv/bin/python -m unittest tests/test_player_search.py
"""
import argparse
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from unittest import mock

import requests

ROOT = Path(__file__).resolve().parent.parent

os.environ["MUSIC_DIR"] = tempfile.mkdtemp(prefix="ember-search-test-")
sys.path.insert(0, str(ROOT))
with mock.patch("ytmusicapi.YTMusic"):
    import player  # noqa: E402

SONG = {"videoId": "aaaaaaaaaaa", "title": "Song", "artists": [{"name": "Band"}], "duration_seconds": 200}
VIDEO = {"videoId": "bbbbbbbbbbb", "title": "Video", "artists": [{"name": "Uploader"}], "duration_seconds": 180}


def run_search(query="anything", limit=30):
    """(exit code, parsed stdout or None, stderr)"""
    out, err = io.StringIO(), io.StringIO()
    code = 0
    with redirect_stdout(out), redirect_stderr(err):
        try:
            player.cmd_search(argparse.Namespace(query=query, limit=limit))
        except SystemExit as e:
            code = e.code
    text = out.getvalue()
    return code, (json.loads(text) if text else None), err.getvalue()


class SearchTest(unittest.TestCase):
    def setUp(self):
        self.answers = {}
        self.yt = mock.MagicMock()

        def search(query, filter, limit):
            a = self.answers[filter]
            if isinstance(a, BaseException):
                raise a
            return a

        self.yt.search.side_effect = search
        self.ytdlp = mock.MagicMock(return_value=[])
        for p in (mock.patch.object(player, "yt", self.yt), mock.patch.object(player, "ytdlp_search", self.ytdlp)):
            p.start()
            self.addCleanup(p.stop)

    def test_songs_network_error_still_reads_videos(self):
        self.answers = {"songs": requests.exceptions.ConnectionError("Connection aborted."), "videos": [VIDEO]}
        code, res, _ = run_search()
        self.assertEqual(code, 0)
        self.assertEqual([t["videoId"] for t in res], ["bbbbbbbbbbb"])
        self.ytdlp.assert_not_called()

    def test_everything_failing_is_an_error_not_no_results(self):
        self.answers = {"songs": requests.exceptions.ConnectionError("Connection aborted."),
                        "videos": requests.exceptions.ConnectionError("Connection aborted.")}
        self.ytdlp.side_effect = Exception("ERROR: Unable to download API page: <urlopen error timed out>")
        code, res, err = run_search()
        self.assertNotEqual(code, 0)
        self.assertIsNone(res)
        self.assertIn("ERROR:", err)

    def test_a_backend_failing_with_nothing_found_is_an_error(self):
        # Videos found nothing, but songs could not be asked: not a real "no results".
        self.answers = {"songs": requests.exceptions.ReadTimeout("Read timed out."), "videos": []}
        code, res, _ = run_search()
        self.assertNotEqual(code, 0)
        self.assertIsNone(res)

    def test_parser_crash_falls_back_to_ytdlp(self):
        self.answers = {"songs": KeyError("musicShelfRenderer"), "videos": KeyError("musicShelfRenderer")}
        self.ytdlp.return_value = [{"id": "ccccccccccc", "title": "Fallback", "uploader": "Chan", "duration": 99}]
        code, res, _ = run_search()
        self.assertEqual(code, 0)
        self.assertEqual([t["videoId"] for t in res], ["ccccccccccc"])

    def test_parser_crash_with_nothing_else_is_no_results(self):
        # A query that always crashes ytmusicapi: retrying won't help, so an
        # empty answer is the honest one.
        self.answers = {"songs": KeyError("musicShelfRenderer"), "videos": KeyError("musicShelfRenderer")}
        code, res, _ = run_search()
        self.assertEqual(code, 0)
        self.assertEqual(res, [])

    def test_genuinely_nothing_found_is_an_empty_list(self):
        self.answers = {"songs": [], "videos": []}
        code, res, _ = run_search()
        self.assertEqual(code, 0)
        self.assertEqual(res, [])

    def test_songs_then_videos(self):
        self.answers = {"songs": [SONG], "videos": [VIDEO]}
        code, res, _ = run_search()
        self.assertEqual(code, 0)
        self.assertEqual([t["videoId"] for t in res], ["aaaaaaaaaaa", "bbbbbbbbbbb"])


if __name__ == "__main__":
    unittest.main()
