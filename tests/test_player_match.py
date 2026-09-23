"""player.py `match`: top 5 raw candidates per query, from saved ytmusicapi
search output (tests/fixtures/imports/ytm-search-bass-persuades.json, a real
`yt.search("Bass Persuades Miley Cyrus", filter="songs")` from 2026-09-19).
No network: YTMusic is replaced before player.py is imported.

    .venv/bin/python -m unittest tests/test_player_match.py
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

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "tests" / "fixtures" / "imports" / "ytm-search-bass-persuades.json"

os.environ["MUSIC_DIR"] = tempfile.mkdtemp(prefix="ember-match-test-")
sys.path.insert(0, str(ROOT))
with mock.patch("ytmusicapi.YTMusic"):
    import player  # noqa: E402


def run_match(queries, title_only=False):
    out = io.StringIO()
    with redirect_stdout(out):
        player.cmd_match(argparse.Namespace(queries=queries, title_only=title_only))
    return json.loads(out.getvalue())


class MatchTest(unittest.TestCase):
    def setUp(self):
        self.hits = json.loads(FIXTURE.read_text())
        self.yt = mock.MagicMock()
        self.yt.search.return_value = self.hits
        patcher = mock.patch.object(player, "yt", self.yt)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_returns_top_five_candidates_in_search_order(self):
        self.assertGreater(len(self.hits), 5)
        res = run_match(["Bass Persuades\tMiley Cyrus"])
        self.assertEqual(len(res["results"]), 1)
        cands = res["results"][0]
        self.assertEqual(len(cands), 5)
        self.assertEqual([c["videoId"] for c in cands], [h["videoId"] for h in self.hits[:5]])

    def test_candidate_fields(self):
        first = run_match(["Bass Persuades\tMiley Cyrus"])["results"][0][0]
        self.assertEqual(first["title"], "Bass Persuades")
        self.assertEqual(first["artists"], ["Miley Cyrus"])
        self.assertEqual(first["artist"], "Miley Cyrus")
        self.assertEqual(first["durationSec"], 203)
        self.assertEqual(first["videoType"], "ATV")
        self.assertIs(first["isExplicit"], False)
        self.assertTrue(first["videoId"])
        self.assertTrue(first["artworkUrl"])
        for key in ("album", "albumId", "artistId"):
            self.assertIn(key, first)

    def test_unscored_raw_candidates(self):
        # The remix is still offered: scoring (and rejecting) it is the web app's job.
        titles = [c["title"] for c in run_match(["Bass Persuades\tMiley Cyrus"])["results"][0]]
        self.assertIn("Bass Persuades Remixx", titles)
        self.assertNotIn("score", run_match(["Bass Persuades\tMiley Cyrus"])["results"][0][0])

    def test_query_forms(self):
        run_match(["Bass Persuades\tMiley Cyrus"])
        self.yt.search.assert_called_with("Bass Persuades Miley Cyrus", filter="songs", limit=5)
        run_match(["Bass Persuades\tMiley Cyrus"], title_only=True)
        self.yt.search.assert_called_with("Bass Persuades", filter="songs", limit=5, ignore_spelling=True)

    def test_one_result_list_per_query_in_order(self):
        self.yt.search.side_effect = [self.hits, [], Exception("503 Service Unavailable")]
        res = run_match(["Bass Persuades\tMiley Cyrus", "Nothing\tNobody", "Broken\tSearch"])
        self.assertEqual([len(r) for r in res["results"]], [5, 0, 0])
        # Nothing found and could not ask are told apart.
        self.assertEqual(res["failed"], [2])

    def test_parser_crash_is_not_found_not_failed(self):
        # ytmusicapi's nav() on a result shape it doesn't know. Retrying the
        # batch hits the same crash every time, so it must not be "failed".
        crash = KeyError("Unable to find 'musicResponsiveListItemRenderer' using path "
                         "['contents', 0, 'musicResponsiveListItemRenderer'] on {'width': 544, 'code': 503}, exception: "
                         "'musicResponsiveListItemRenderer'")
        self.yt.search.side_effect = [self.hits, crash, TypeError("'NoneType' object is not subscriptable")]
        with redirect_stderr(io.StringIO()):
            res = run_match(["Bass Persuades\tMiley Cyrus", "Odd\tShape", "Odd\tType"])
        self.assertEqual([len(r) for r in res["results"]], [5, 0, 0])
        self.assertEqual(res["failed"], [])

    def test_network_and_busy_errors_still_fail(self):
        import requests
        from ytmusicapi.exceptions import YTMusicServerError
        self.yt.search.side_effect = [
            YTMusicServerError("Server returned HTTP 503: Service Unavailable.\nThe service is currently unavailable."),
            YTMusicServerError("Server returned HTTP 429: Too Many Requests.\nslow down"),
            requests.exceptions.ConnectionError("Connection aborted."),
            requests.exceptions.ReadTimeout("Read timed out. (read timeout=30)"),
            json.JSONDecodeError("Expecting value", "<html>", 0),
        ]
        with redirect_stderr(io.StringIO()):
            res = run_match(["A\ta", "B\tb", "C\tc", "D\td", "E\te"])
        self.assertEqual(res["failed"], [0, 1, 2, 3, 4])

    def test_empty_title_is_an_empty_list(self):
        res = run_match(["\tMiley Cyrus"])
        self.assertEqual(res["results"], [[]])
        self.yt.search.assert_not_called()

    def test_missing_optional_fields(self):
        self.yt.search.return_value = [
            {"videoId": "abcdefghijk", "title": "Upload", "artists": [{"name": "Someone"}],
             "duration_seconds": 100, "thumbnails": []},
            {"title": "No id"},
        ]
        cands = run_match(["Upload\tSomeone"])["results"][0]
        self.assertEqual(len(cands), 1)
        self.assertIsNone(cands[0]["videoType"])
        self.assertIsNone(cands[0]["isExplicit"])


class YtPlaylistFallbackTest(unittest.TestCase):
    def test_falls_back_to_ytdlp_when_ytmusicapi_fails(self):
        yt = mock.MagicMock()
        yt.get_playlist.side_effect = Exception("boom")
        listing = {"title": "Mix", "entries": [
            {"id": "aaaaaaaaaaa", "title": "One", "channel": "Band - Topic", "duration": 200},
            {"id": "bbbbbbbbbbb", "title": "Gone", "duration": None},
        ]}
        ydl = mock.MagicMock()
        ydl.__enter__.return_value.extract_info.return_value = listing
        out = io.StringIO()
        with mock.patch.object(player, "yt", yt), mock.patch.object(player.yt_dlp, "YoutubeDL", return_value=ydl), \
                redirect_stdout(out):
            player.cmd_ytplaylist(argparse.Namespace(playlist_id="PL1234567890"))
        res = json.loads(out.getvalue())
        self.assertEqual(res["title"], "Mix")
        self.assertEqual([t["videoId"] for t in res["tracks"]], ["aaaaaaaaaaa"])
        self.assertEqual(res["tracks"][0]["artist"], "Band")

    def test_reports_a_reason_when_both_fail(self):
        yt = mock.MagicMock()
        yt.get_playlist.side_effect = Exception("boom")
        ydl = mock.MagicMock()
        ydl.__enter__.return_value.extract_info.side_effect = Exception("ERROR: This playlist is private")
        out = io.StringIO()
        with mock.patch.object(player, "yt", yt), mock.patch.object(player.yt_dlp, "YoutubeDL", return_value=ydl), \
                redirect_stdout(out):
            player.cmd_ytplaylist(argparse.Namespace(playlist_id="PL1234567890"))
        self.assertEqual(json.loads(out.getvalue())["reason"], "private")


if __name__ == "__main__":
    unittest.main()
