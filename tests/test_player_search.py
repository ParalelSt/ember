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


def run_stream(query="anything", limit=30):
    """(exit code, {part: payload} from the NDJSON lines, raw lines, stderr)"""
    out, err = io.StringIO(), io.StringIO()
    code = 0
    with redirect_stdout(out), redirect_stderr(err):
        try:
            player.cmd_search(argparse.Namespace(query=query, limit=limit, stream=True))
        except SystemExit as e:
            code = e.code
    lines = [json.loads(line) for line in out.getvalue().splitlines() if line.strip()]
    parts = {line["part"]: line.get("tracks", line.get("artists")) for line in lines}
    return code, parts, lines, err.getvalue()


ARTIST = {"browseId": "UCdemetori00000000000000", "artist": "Demetori",
          "thumbnails": [{"url": "https://lh3.googleusercontent.com/abc=w60-h60-p-l90-rj"},
                         {"url": "https://lh3.googleusercontent.com/abc=w120-h120-p-l90-rj"}]}


class FakeBackends(unittest.TestCase):
    """YTMusic and yt-dlp replaced; `self.answers[filter]` is what (or what
    error) each ytmusicapi search filter gives back."""

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


class SearchTest(FakeBackends):

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



class StreamSearchTest(FakeBackends):
    """`search --stream`: one JSON line per lookup, plus artists."""

    def test_each_lookup_is_its_own_line(self):
        self.answers = {"songs": [SONG], "videos": [VIDEO], "artists": [ARTIST]}
        code, parts, lines, _ = run_stream()
        self.assertEqual(code, 0)
        self.assertEqual(sorted(line["part"] for line in lines), ["artists", "songs", "videos"])
        self.assertEqual([t["videoId"] for t in parts["songs"]], ["aaaaaaaaaaa"])
        self.assertEqual([t["videoId"] for t in parts["videos"]], ["bbbbbbbbbbb"])
        self.ytdlp.assert_not_called()

    def test_artists_are_id_name_and_a_bigger_picture(self):
        self.answers = {"songs": [SONG], "videos": [], "artists": [ARTIST, {"artist": "No id"}]}
        _, parts, _, _ = run_stream()
        self.assertEqual(parts["artists"], [{
            "id": "UCdemetori00000000000000",
            "name": "Demetori",
            "artworkUrl": "https://lh3.googleusercontent.com/abc=w240-h240-p-l90-rj",
        }])

    def test_artists_are_asked_with_the_artists_filter(self):
        self.answers = {"songs": [], "videos": [VIDEO], "artists": []}
        run_stream("demetori")
        filters = sorted(c.kwargs["filter"] for c in self.yt.search.call_args_list)
        self.assertEqual(filters, ["artists", "songs", "videos"])

    def test_artists_failing_never_fails_the_search(self):
        self.answers = {"songs": [SONG], "videos": [], "artists": requests.exceptions.ConnectionError("x")}
        code, parts, _, _ = run_stream()
        self.assertEqual(code, 0)
        self.assertEqual(parts["artists"], [])
        self.assertEqual(len(parts["songs"]), 1)

    def test_duplicates_inside_a_lookup_are_dropped(self):
        self.answers = {"songs": [SONG, SONG], "videos": [], "artists": []}
        _, parts, _, _ = run_stream()
        self.assertEqual(len(parts["songs"]), 1)

    def test_nothing_found_falls_back_to_ytdlp_as_its_own_line(self):
        self.answers = {"songs": KeyError("x"), "videos": [], "artists": []}
        self.ytdlp.return_value = [{"id": "ccccccccccc", "title": "Fallback", "uploader": "Chan", "duration": 99}]
        code, parts, _, _ = run_stream()
        self.assertEqual(code, 0)
        self.assertEqual([t["videoId"] for t in parts["fallback"]], ["ccccccccccc"])

    def test_unreachable_with_nothing_found_is_an_error(self):
        self.answers = {"songs": requests.exceptions.ReadTimeout("t"), "videos": [], "artists": [ARTIST]}
        code, _, _, err = run_stream()
        self.assertNotEqual(code, 0)
        self.assertIn("ERROR:", err)

    def test_every_line_is_one_line_of_json(self):
        self.answers = {"songs": [dict(SONG, title="Two\nlines")], "videos": [], "artists": []}
        out = io.StringIO()
        with redirect_stdout(out), redirect_stderr(io.StringIO()):
            player.cmd_search(argparse.Namespace(query="q", limit=30, stream=True))
        for line in out.getvalue().splitlines():
            json.loads(line)


if __name__ == "__main__":
    unittest.main()
