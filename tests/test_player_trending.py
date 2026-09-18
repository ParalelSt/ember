"""player.py trending: the chart playlist picker and its fallback chain.

    .venv/bin/python -m unittest tests/test_player_trending.py

Runs against saved ytmusicapi output (tests/fixtures/trending/), captured
live on 2026-09-18 with ytmusicapi 1.12.2. No network: `yt` and the yt-dlp
helper are replaced with stubs. If ytmusicapi changes the get_charts shape
again, the picker test fails here instead of the shelf silently showing
something that is not a chart.
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures" / "trending"

# player.py creates MUSIC_DIR on import; keep that out of the repo.
os.environ["MUSIC_DIR"] = tempfile.mkdtemp(prefix="ember-trending-test-")
sys.path.insert(0, str(ROOT))
import player  # noqa: E402


def load(name):
    with open(FIXTURES / name, encoding="utf-8") as f:
        return json.load(f)


class StubYT:
    def __init__(self, charts=None, playlist=None, charts_error=None, playlist_error=None):
        self.charts, self.playlist = charts, playlist
        self.charts_error, self.playlist_error = charts_error, playlist_error
        self.playlist_ids = []

    def get_charts(self, country="ZZ"):
        if self.charts_error:
            raise self.charts_error
        return self.charts

    def get_playlist(self, playlist_id, limit=None):
        self.playlist_ids.append(playlist_id)
        if self.playlist_error:
            raise self.playlist_error
        return self.playlist


class TrendingPlaylistPickerTest(unittest.TestCase):
    def setUp(self):
        self.real_yt = player.yt
        self.real_ytdlp = player.ytdlp_playlist

    def tearDown(self):
        player.yt = self.real_yt
        player.ytdlp_playlist = self.real_ytdlp

    def test_picks_daily_chart_from_saved_get_charts(self):
        picked = player.pick_chart_playlist(load("get_charts_ZZ.json"))
        self.assertEqual(picked["title"], "Daily Top Music Videos - Global")
        self.assertEqual(picked["playlistId"], player.GLOBAL_DAILY_CHART_ID)

    def test_prefers_daily_over_trending_20_and_top_100(self):
        charts = {"videos": [
            {"title": "Trending 20 Germany", "playlistId": "PLtrending20"},
            {"title": "Top 100 Music Videos Germany", "playlistId": "PLtop100"},
            {"title": "Daily Top Music Videos - Germany", "playlistId": "PLdaily"},
        ]}
        self.assertEqual(player.pick_chart_playlist(charts)["playlistId"], "PLdaily")
        charts["videos"].pop()
        self.assertEqual(player.pick_chart_playlist(charts)["playlistId"], "PLtrending20")

    def test_unknown_shapes_give_none(self):
        self.assertIsNone(player.pick_chart_playlist({}))
        self.assertIsNone(player.pick_chart_playlist(None))
        self.assertIsNone(player.pick_chart_playlist({"videos": [{"title": "no id"}]}))

    def test_chart_tracks_keeps_rank_order_and_drops_unplayable(self):
        playlist = load("get_playlist_daily_global.json")
        playlist["tracks"].insert(1, {"videoId": None, "title": "No id"})
        playlist["tracks"].insert(2, {"videoId": "gone0000000", "title": "Gone", "isAvailable": False})
        player.yt = StubYT(charts=load("get_charts_ZZ.json"), playlist=playlist)
        chart = player.chart_tracks("ZZ")
        self.assertEqual(chart["source"], "ytmusicapi")
        self.assertEqual(chart["title"], "Daily Top Music Videos - Global")
        self.assertEqual(len(chart["tracks"]), 50)
        want = [t["videoId"] for t in load("get_playlist_daily_global.json")["tracks"]]
        self.assertEqual([t["videoId"] for t in chart["tracks"]], want)
        first = chart["tracks"][0]
        self.assertEqual((first["title"], first["artist"], first["durationSec"]), ("Dai Dai", "Shakira", 241))

    def test_get_charts_failure_uses_the_global_daily_id(self):
        stub = StubYT(charts_error=RuntimeError("HTTP 503"), playlist=load("get_playlist_daily_global.json"))
        player.yt = stub
        self.assertEqual(len(player.chart_tracks("DE")["tracks"]), 50)
        self.assertEqual(stub.playlist_ids, [player.GLOBAL_DAILY_CHART_ID])

    def test_get_playlist_failure_falls_back_to_ytdlp_on_the_same_id(self):
        player.yt = StubYT(charts=load("get_charts_ZZ.json"), playlist_error=RuntimeError("HTTP 503"))
        seen = []
        player.ytdlp_playlist = lambda pid: seen.append(pid) or [{"videoId": "abcdefghijk", "title": "X"}]
        chart = player.chart_tracks("ZZ")
        self.assertEqual(chart["source"], "yt-dlp")
        self.assertEqual(seen, [player.GLOBAL_DAILY_CHART_ID])

    def test_every_source_failing_raises_instead_of_searching(self):
        player.yt = StubYT(charts=load("get_charts_ZZ.json"), playlist_error=RuntimeError("HTTP 503"))
        player.ytdlp_playlist = lambda pid: []
        with self.assertRaises(RuntimeError):
            player.chart_tracks("ZZ")


if __name__ == "__main__":
    unittest.main()
