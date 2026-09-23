"""player.py trending: the chart playlist picker and its fallback chain.

    .venv/bin/python -m unittest tests/test_player_trending.py

Runs against saved ytmusicapi output (tests/fixtures/trending/), captured
live on 2026-09-18 with ytmusicapi 1.12.2. No network: `yt` and the yt-dlp
helper are replaced with stubs. If ytmusicapi changes the get_charts shape
again, the picker test fails here instead of the shelf silently showing
something that is not a chart.
"""
import argparse
import contextlib
import io
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

    def test_allow_global_fallback_false_raises_instead_of_substituting(self):
        # A missing country chart must not be silently swapped for the
        # global chart when it will be counted (and labeled) as DE's own.
        stub = StubYT(charts_error=RuntimeError("HTTP 503"), playlist=load("get_playlist_daily_global.json"))
        player.yt = stub
        with self.assertRaises(RuntimeError):
            player.chart_tracks("DE", allow_global_fallback=False)
        self.assertEqual(stub.playlist_ids, [])  # never even asked for the global playlist

    def test_allow_global_fallback_true_still_substitutes(self):
        stub = StubYT(charts_error=RuntimeError("HTTP 503"), playlist=load("get_playlist_daily_global.json"))
        player.yt = stub
        chart = player.chart_tracks("DE", allow_global_fallback=True)
        self.assertEqual(len(chart["tracks"]), 50)
        self.assertEqual(stub.playlist_ids, [player.GLOBAL_DAILY_CHART_ID])


class NormalizeSongKeyTest(unittest.TestCase):
    def test_ignores_case_punctuation_and_spacing(self):
        self.assertEqual(
            player.normalize_song_key("Song, Title!", "The Artist"),
            player.normalize_song_key("song title", "the artist"),
        )

    def test_different_songs_get_different_keys(self):
        self.assertNotEqual(
            player.normalize_song_key("Song A", "Artist"),
            player.normalize_song_key("Song B", "Artist"),
        )


def track(vid, title, artist="Artist"):
    return {"videoId": vid, "title": title, "artist": artist, "artworkUrl": "", "durationSec": 200}


class BlendChartsTest(unittest.TestCase):
    """player.blend_charts: the Borda-style merge across country charts."""

    def test_borda_merge_order(self):
        # US: A=3pts, B=2pts, C=1pt. GB: B=3pts, C=2pts, A=1pt.
        # Totals: A=4, B=5, C=3 -> blended order B, A, C.
        us = [track("aaa", "A"), track("bbb", "B"), track("ccc", "C")]
        gb = [track("bbb", "B"), track("ccc", "C"), track("aaa", "A")]
        out = player.blend_charts([("US", us), ("GB", gb)])
        self.assertEqual([t["videoId"] for t in out], ["bbb", "aaa", "ccc"])

    def test_dedupe_by_video_id_across_countries(self):
        us = [track("vid1", "Song One")]
        de = [track("vid1", "Song One (Remix title in DE)")]
        out = player.blend_charts([("US", us), ("DE", de)])
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0]["videoId"], "vid1")

    def test_dedupe_by_title_and_artist_across_countries_with_different_video_ids(self):
        us = [track("vidA", "Same Song", "Same Artist")]
        de = [track("vidB", "same song", "same artist")]
        out = player.blend_charts([("US", us), ("DE", de)])
        self.assertEqual(len(out), 1)
        self.assertIn(out[0]["videoId"], ("vidA", "vidB"))

    def test_ties_break_on_best_single_rank(self):
        # v1: US rank 1 of 1 -> 1 point, best_rank 1.
        # v3: GB rank 2 of 2 -> 1 point, best_rank 2.
        # Equal score, v1 must sort first on its better rank.
        us = [track("v1", "One")]
        gb = [track("v2", "Two"), track("v3", "Three")]
        out = player.blend_charts([("US", us), ("GB", gb)])
        ids = [t["videoId"] for t in out]
        self.assertLess(ids.index("v1"), ids.index("v3"))

    def test_caps_at_100(self):
        us = [track(f"us{i:03d}", f"US Song {i}") for i in range(1, 61)]
        gb = [track(f"gb{i:03d}", f"GB Song {i}") for i in range(1, 61)]
        out = player.blend_charts([("US", us), ("GB", gb)])
        self.assertEqual(len(out), 100)

    def test_single_country_keeps_its_original_rank_order(self):
        us = [track(f"us{i:03d}", f"Song {i}") for i in range(1, 6)]
        out = player.blend_charts([("US", us)])
        self.assertEqual([t["videoId"] for t in out], [t["videoId"] for t in us])


class FetchCountryChartsTest(unittest.TestCase):
    """player.fetch_country_charts: sequential per-country fetch with pacing,
    tolerant of individual country failures."""

    def setUp(self):
        self.real_chart_tracks = player.chart_tracks
        self.real_pacing = player.CHART_FETCH_PACING_SEC
        player.CHART_FETCH_PACING_SEC = 0  # no real delay in tests

    def tearDown(self):
        player.chart_tracks = self.real_chart_tracks
        player.CHART_FETCH_PACING_SEC = self.real_pacing

    def test_partial_country_failure_blends_the_rest(self):
        def fake(country, allow_global_fallback=True):
            if country == "DE":
                raise RuntimeError("HTTP 503")
            return {"title": None, "playlistId": "p", "source": "ytmusicapi", "tracks": [track(f"{country}1", "T")]}
        player.chart_tracks = fake
        successes, failures = player.fetch_country_charts(["US", "DE", "GB"])
        self.assertEqual([c for c, _ in successes], ["US", "GB"])
        self.assertEqual(failures, ["DE"])

    def test_all_countries_failing_gives_no_successes(self):
        player.chart_tracks = lambda country, allow_global_fallback=True: (_ for _ in ()).throw(RuntimeError("down"))
        successes, failures = player.fetch_country_charts(["US", "GB"])
        self.assertEqual(successes, [])
        self.assertEqual(failures, ["US", "GB"])

    def test_passes_allow_global_fallback_through_to_chart_tracks(self):
        seen = []

        def fake(country, allow_global_fallback=True):
            seen.append((country, allow_global_fallback))
            return {"title": None, "playlistId": "p", "source": "ytmusicapi", "tracks": [track(f"{country}1", "T")]}
        player.chart_tracks = fake
        player.fetch_country_charts(["US", "GB"], allow_global_fallback=False)
        self.assertEqual(seen, [("US", False), ("GB", False)])


class CmdTrendingTest(unittest.TestCase):
    """player.cmd_trending: the CLI entry point, --countries parsing and the
    printed JSON shape."""

    def setUp(self):
        self.real_chart_tracks = player.chart_tracks
        self.real_pacing = player.CHART_FETCH_PACING_SEC
        player.CHART_FETCH_PACING_SEC = 0

    def tearDown(self):
        player.chart_tracks = self.real_chart_tracks
        player.CHART_FETCH_PACING_SEC = self.real_pacing

    def _run(self, countries=None, country="ZZ"):
        args = argparse.Namespace(countries=countries, country=country)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            player.cmd_trending(args)
        return json.loads(buf.getvalue())

    def test_blends_countries_and_reports_which_were_used(self):
        def fake(country, allow_global_fallback=True):
            return {"title": None, "playlistId": "p", "source": "ytmusicapi", "tracks": [track(f"{country}1", f"{country} Song")]}
        player.chart_tracks = fake
        out = self._run(countries="US,GB,DE")
        self.assertEqual(out["countries"], ["US", "GB", "DE"])
        self.assertEqual(len(out["tracks"]), 3)

    def test_partial_failure_still_returns_the_successful_countries(self):
        def fake(country, allow_global_fallback=True):
            if country == "DE":
                raise RuntimeError("HTTP 503")
            return {"title": None, "playlistId": "p", "source": "ytmusicapi", "tracks": [track(f"{country}1", f"{country} Song")]}
        player.chart_tracks = fake
        out = self._run(countries="US,DE,GB")
        self.assertEqual(out["countries"], ["US", "GB"])

    def test_every_country_failing_exits_nonzero(self):
        player.chart_tracks = lambda country, allow_global_fallback=True: (_ for _ in ()).throw(RuntimeError("down"))
        with self.assertRaises(SystemExit) as ctx:
            self._run(countries="US,GB")
        self.assertEqual(ctx.exception.code, 1)

    def test_no_countries_falls_back_to_single_country_arg(self):
        player.chart_tracks = lambda country, allow_global_fallback=True: {"title": None, "playlistId": "p", "source": "ytmusicapi", "tracks": [track("z1", "Global Song")]}
        out = self._run(countries=None, country="ZZ")
        self.assertEqual(out["countries"], ["ZZ"])

    def test_blend_of_several_countries_does_not_allow_the_global_substitute(self):
        # DE has no chart of its own here; before the fix chart_tracks would
        # silently hand back the global chart labeled as DE's, so the blend
        # double-counted the same global chart under two country names.
        # Now a country with no chart of its own is skipped like any other
        # failure instead of standing in for the global chart.
        seen = []

        def fake(country, allow_global_fallback=True):
            seen.append((country, allow_global_fallback))
            if country == "DE":
                raise RuntimeError("trending: no chart playlist found for DE")
            return {"title": None, "playlistId": "p", "source": "ytmusicapi", "tracks": [track(f"{country}1", f"{country} Song")]}
        player.chart_tracks = fake
        out = self._run(countries="US,DE,GB")
        self.assertEqual(seen, [("US", False), ("DE", False), ("GB", False)])
        self.assertEqual(out["countries"], ["US", "GB"])

    def test_a_single_country_still_allows_the_global_substitute(self):
        seen = []

        def fake(country, allow_global_fallback=True):
            seen.append(allow_global_fallback)
            return {"title": None, "playlistId": "p", "source": "ytmusicapi", "tracks": [track("z1", "Global Song")]}
        player.chart_tracks = fake
        self._run(countries="DE")
        self.assertEqual(seen, [True])


if __name__ == "__main__":
    unittest.main()
