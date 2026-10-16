"""player.py genre-charts and radio-batch: the genre chart picker, pacing,
partial and total failure.

    .venv/bin/python -m unittest tests/test_player_genre_charts.py

Runs against saved ytmusicapi output (tests/fixtures/genre-charts/),
captured live on 2026-10-16 with ytmusicapi 1.12.2: get_charts('US'), the
Rock genre chart's get_playlist and one get_watch_playlist. No network:
`yt` is replaced with a stub and the pacing sleep is recorded, not slept.
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
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "tests" / "fixtures" / "genre-charts"
TRENDING = ROOT / "tests" / "fixtures" / "trending"

os.environ["MUSIC_DIR"] = tempfile.mkdtemp(prefix="ember-genre-test-")
sys.path.insert(0, str(ROOT))
with mock.patch("ytmusicapi.YTMusic"):
    import player  # noqa: E402


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


US_CHARTS = load(FIXTURES / "get_charts_US.json")
ROCK = load(FIXTURES / "get_playlist_rock.json")
WATCH = load(FIXTURES / "get_watch_playlist.json")
RS_DAILY = load(TRENDING / "get_playlist_daily_global.json")


class StubYT:
    """get_charts / get_playlist / get_watch_playlist with per-id failures,
    recording every call in order."""

    def __init__(self, charts=US_CHARTS, playlists=None, fail_playlists=(), charts_error=None,
                 rs_charts=None, watch=None, fail_seeds=()):
        self.charts = charts
        self.rs_charts = rs_charts if rs_charts is not None else {
            "videos": [{"title": "Daily Top Music Videos - Serbia", "playlistId": "PLrsdaily"}]}
        self.playlists = playlists or {}
        self.fail_playlists = set(fail_playlists)
        self.charts_error = charts_error
        self.watch = watch or {}
        self.fail_seeds = set(fail_seeds)
        self.calls = []

    def get_charts(self, country="ZZ"):
        self.calls.append(("get_charts", country))
        if country == "RS":
            return self.rs_charts
        if self.charts_error:
            raise self.charts_error
        return self.charts

    def get_playlist(self, playlist_id, limit=None):
        self.calls.append(("get_playlist", playlist_id))
        if playlist_id in self.fail_playlists:
            raise RuntimeError("HTTP 503")
        if playlist_id == "PLrsdaily":
            return RS_DAILY
        return self.playlists.get(playlist_id, ROCK)

    def get_watch_playlist(self, videoId=None, limit=25):
        self.calls.append(("get_watch_playlist", videoId))
        if videoId in self.fail_seeds:
            raise RuntimeError("HTTP 503")
        return self.watch.get(videoId, WATCH)


class Base(unittest.TestCase):
    def setUp(self):
        self.sleeps = []
        p1 = mock.patch.object(player.time, "sleep", side_effect=lambda s: self.sleeps.append(s))
        p1.start()
        self.addCleanup(p1.stop)
        p2 = mock.patch.object(player, "ytdlp_playlist", side_effect=lambda pid: [])
        p2.start()
        self.addCleanup(p2.stop)

    def use(self, stub):
        p = mock.patch.object(player, "yt", stub)
        p.start()
        self.addCleanup(p.stop)
        return stub

    def run_cmd(self, fn, **kw):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            fn(argparse.Namespace(**kw))
        return json.loads(buf.getvalue())


class PickGenreChartsTest(unittest.TestCase):
    def test_saved_us_charts_give_the_eight_genres_with_stable_slugs(self):
        picked = player.pick_genre_charts(US_CHARTS)
        self.assertEqual(sorted(g["slug"] for g in picked), sorted([
            "jazz", "hard-rock-metal", "rock", "country", "pop", "hip-hop", "latin", "dance-electronic"]))
        rock = next(g for g in picked if g["slug"] == "rock")
        self.assertEqual(rock["title"], "Rock")
        self.assertTrue(rock["playlistId"].startswith("PL4fGSI1pDJn"))
        metal = next(g for g in picked if g["slug"] == "hard-rock-metal")
        self.assertEqual(metal["title"], "Hard Rock & Metal")

    def test_unknown_genre_gets_a_slug_from_its_name(self):
        picked = player.pick_genre_charts({"genres": [{"title": "Top 50 R&B & Soul Music Videos United States", "playlistId": "PLx"}]})
        self.assertEqual(picked, [{"slug": "r-b-soul", "title": "R&B & Soul", "playlistId": "PLx"}])

    def test_unknown_shapes_give_nothing(self):
        self.assertEqual(player.pick_genre_charts(None), [])
        self.assertEqual(player.pick_genre_charts({}), [])
        self.assertEqual(player.pick_genre_charts({"genres": [{"title": "no id"}]}), [])
        self.assertEqual(player.pick_genre_charts({"genres": {"items": [{"title": "Top 50 Pop Music Videos", "playlistId": "P"}]}}),
                         [{"slug": "pop", "title": "Pop", "playlistId": "P"}])


class GenreChartsTest(Base):
    def test_every_genre_plus_balkan_paced_apart(self):
        stub = self.use(StubYT())
        out = self.run_cmd(player.cmd_genre_charts, country="US")
        slugs = [c["slug"] for c in out["charts"]]
        self.assertEqual(len(slugs), 9)
        self.assertEqual(slugs[-1], "balkan")
        self.assertEqual(out["failed"], [])
        rock = next(c for c in out["charts"] if c["slug"] == "rock")
        self.assertEqual(len(rock["tracks"]), 50)
        self.assertEqual(rock["tracks"][0]["videoId"], ROCK["tracks"][0]["videoId"])
        self.assertEqual(rock["tracks"][0]["artist"], "Kid Rock")
        balkan = out["charts"][-1]
        self.assertEqual(balkan["title"], "Balkan")
        self.assertEqual(balkan["playlistId"], "PLrsdaily")
        # One get_charts(US), eight playlists, then RS: a pause before each
        # call after the first (the RS chart's own two calls go back to back,
        # as the trending chart's always have).
        self.assertEqual(stub.calls[0], ("get_charts", "US"))
        self.assertEqual(sum(1 for c in stub.calls if c[0] == "get_playlist"), 9)
        self.assertEqual(self.sleeps, [player.CHART_FETCH_PACING_SEC] * 9)

    def test_a_failing_genre_is_skipped_and_named(self):
        rock_id = next(g["playlistId"] for g in player.pick_genre_charts(US_CHARTS) if g["slug"] == "rock")
        self.use(StubYT(fail_playlists=[rock_id]))
        out = self.run_cmd(player.cmd_genre_charts, country="US")
        self.assertNotIn("rock", [c["slug"] for c in out["charts"]])
        self.assertEqual(out["failed"], ["rock"])
        self.assertEqual(len(out["charts"]), 8)

    def test_get_charts_failing_still_returns_balkan(self):
        self.use(StubYT(charts_error=RuntimeError("HTTP 503")))
        out = self.run_cmd(player.cmd_genre_charts, country="US")
        self.assertEqual([c["slug"] for c in out["charts"]], ["balkan"])
        self.assertEqual(out["failed"], ["genres"])

    def test_balkan_never_falls_back_to_the_global_chart(self):
        # Serbia's chart missing must not put the global chart under "Balkan".
        stub = self.use(StubYT(rs_charts={}))
        out = self.run_cmd(player.cmd_genre_charts, country="US")
        self.assertNotIn("balkan", [c["slug"] for c in out["charts"]])
        self.assertIn("balkan", out["failed"])
        self.assertNotIn(("get_playlist", player.GLOBAL_DAILY_CHART_ID), stub.calls)

    def test_every_chart_failing_exits_nonzero(self):
        self.use(StubYT(charts_error=RuntimeError("HTTP 503"), rs_charts={}))
        with self.assertRaises(SystemExit) as ctx:
            self.run_cmd(player.cmd_genre_charts, country="US")
        self.assertEqual(ctx.exception.code, 1)

    def test_cli_parses_the_command(self):
        stub = self.use(StubYT())
        buf = io.StringIO()
        with mock.patch.object(sys, "argv", ["player.py", "genre-charts"]), contextlib.redirect_stdout(buf):
            player.main()
        self.assertEqual(len(json.loads(buf.getvalue())["charts"]), 9)
        self.assertEqual(stub.calls[0], ("get_charts", "US"))


class RadioBatchTest(Base):
    def test_each_seed_gets_its_radio_without_itself_paced_apart(self):
        seed = WATCH["tracks"][0]["videoId"]
        stub = self.use(StubYT())
        out = self.run_cmd(player.cmd_radio_batch, seeds=f"{seed},-UaaeSP971U", limit=30)
        self.assertEqual([r["seed"] for r in out["radios"]], [seed, "-UaaeSP971U"])
        first = out["radios"][0]["tracks"]
        self.assertEqual(len(first), 30)
        self.assertNotIn(seed, [t["videoId"] for t in first])
        self.assertTrue(all(t["artist"] and t["durationSec"] > 0 for t in first))
        self.assertEqual(out["failed"], [])
        self.assertEqual(self.sleeps, [player.CHART_FETCH_PACING_SEC])
        self.assertEqual([c for c in stub.calls if c[0] == "get_watch_playlist"],
                         [("get_watch_playlist", seed), ("get_watch_playlist", "-UaaeSP971U")])

    def test_partial_failure_keeps_the_rest(self):
        self.use(StubYT(fail_seeds=["bbbbbbbbbbb"]))
        out = self.run_cmd(player.cmd_radio_batch, seeds="aaaaaaaaaaa,bbbbbbbbbbb,ccccccccccc", limit=5)
        self.assertEqual([r["seed"] for r in out["radios"]], ["aaaaaaaaaaa", "ccccccccccc"])
        self.assertEqual(out["failed"], ["bbbbbbbbbbb"])
        self.assertTrue(all(len(r["tracks"]) == 5 for r in out["radios"]))

    def test_every_seed_failing_exits_nonzero(self):
        self.use(StubYT(fail_seeds=["aaaaaaaaaaa", "bbbbbbbbbbb"]))
        with self.assertRaises(SystemExit) as ctx:
            self.run_cmd(player.cmd_radio_batch, seeds="aaaaaaaaaaa,bbbbbbbbbbb", limit=5)
        self.assertEqual(ctx.exception.code, 1)

    def test_no_seeds_prints_an_empty_batch(self):
        stub = self.use(StubYT())
        out = self.run_cmd(player.cmd_radio_batch, seeds=" , ", limit=5)
        self.assertEqual(out, {"radios": [], "failed": []})
        self.assertEqual(stub.calls, [])

    def test_duplicate_seeds_are_asked_once(self):
        stub = self.use(StubYT())
        self.run_cmd(player.cmd_radio_batch, seeds="aaaaaaaaaaa,aaaaaaaaaaa", limit=5)
        self.assertEqual(len(stub.calls), 1)

    def test_cli_accepts_hyphen_leading_seeds_in_equals_form(self):
        self.use(StubYT())
        buf = io.StringIO()
        with mock.patch.object(sys, "argv", ["player.py", "radio-batch", "--seeds=-UaaeSP971U,-kPEbV8T35k", "--limit", "3"]), \
                contextlib.redirect_stdout(buf):
            player.main()
        out = json.loads(buf.getvalue())
        self.assertEqual([r["seed"] for r in out["radios"]], ["-UaaeSP971U", "-kPEbV8T35k"])


if __name__ == "__main__":
    unittest.main()
