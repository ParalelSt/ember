"""player.py new-releases: the batch scan behind the Home "New releases" row.

    .venv/bin/python -m unittest tests/test_player_new_releases.py

Runs against saved, trimmed ytmusicapi answers (tests/fixtures/new-releases/:
get_artist and get_explore, shapes recorded from ytmusicapi 1.12.2). No
network: `yt` is replaced with a stub and the pacing sleep is recorded, not
slept.
"""
import argparse
import copy
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
FIXTURES = ROOT / "tests" / "fixtures" / "new-releases"
BROWSE = ROOT / "tests" / "fixtures" / "artist" / "browse-visual-header.json"

os.environ["MUSIC_DIR"] = tempfile.mkdtemp(prefix="ember-new-releases-test-")
sys.path.insert(0, str(ROOT))
with mock.patch("ytmusicapi.YTMusic"):
    import player  # noqa: E402


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


ARTIST = load(FIXTURES / "get_artist.json")
EXPLORE = load(FIXTURES / "get_explore.json")
LAYOUT_ERROR = KeyError("musicImmersiveHeaderRenderer")


class StubYT:
    """get_artist / get_explore / raw browse with per-id failures, recording
    every call in order. `search` exists only to prove it is never used."""

    def __init__(self, artists=None, fail=None, explore=EXPLORE, explore_error=None, browse=None):
        self.artists = artists or {}
        self.fail = fail or {}
        self.explore = explore
        self.explore_error = explore_error
        self.browse = browse
        self.calls = []
        self.parser = mock.Mock()
        self.parser.parse_channel_contents.return_value = {}

    def get_artist(self, channelId):
        self.calls.append(("get_artist", channelId))
        if channelId in self.fail:
            raise self.fail[channelId]
        return copy.deepcopy(self.artists.get(channelId, ARTIST))

    def get_explore(self):
        self.calls.append(("get_explore",))
        if self.explore_error:
            raise self.explore_error
        return copy.deepcopy(self.explore)

    def _send_request(self, endpoint, body):
        self.calls.append(("browse", body["browseId"]))
        if self.browse is None:
            raise RuntimeError("HTTP 503")
        return copy.deepcopy(self.browse)

    def search(self, *a, **k):
        self.calls.append(("search",))
        raise AssertionError("new-releases must never search")


class Base(unittest.TestCase):
    def setUp(self):
        self.sleeps = []
        p = mock.patch.object(player.time, "sleep", side_effect=lambda s: self.sleeps.append(s))
        p.start()
        self.addCleanup(p.stop)

    def run_cmd(self, yt, artists="", explore=False):
        out, err = io.StringIO(), io.StringIO()
        code = 0
        with mock.patch.object(player, "yt", yt), redirect_stdout(out), redirect_stderr(err):
            try:
                player.cmd_new_releases(argparse.Namespace(artists=artists, explore=explore))
            except SystemExit as e:
                code = e.code
        return code, (json.loads(out.getvalue()) if out.getvalue() else None), err.getvalue()


class Shape(Base):
    def test_output_shape_and_types(self):
        code, out, _ = self.run_cmd(StubYT(), "UCaaaaaaaa", explore=True)
        self.assertEqual(code, 0)
        self.assertEqual(set(out), {"artists", "explore", "failed"})
        self.assertEqual(out["failed"], [])
        (a,) = out["artists"]
        self.assertEqual((a["id"], a["name"]), ("UCaaaaaaaa", "Dražen Zečić"))
        by_id = {r["browseId"]: r for r in a["releases"]}
        for r in a["releases"]:
            self.assertEqual(set(r), {"browseId", "title", "year", "type", "artworkUrl"})
        self.assertEqual(by_id["MPREb_album0001AAA"]["type"], "Album")
        self.assertEqual(by_id["MPREb_album0002BBB"]["type"], "Album")
        self.assertEqual(by_id["MPREb_single001CCC"]["type"], "Single")
        self.assertEqual(by_id["MPREb_single002DDD"]["type"], "EP")
        self.assertEqual(by_id["MPREb_album0001AAA"]["artworkUrl"], "https://lh3.googleusercontent.com/a1=w226-h226")
        self.assertIsNone(by_id["MPREb_single003EEE"]["artworkUrl"])

    def test_year_passes_through_untouched(self):
        _, out, _ = self.run_cmd(StubYT(), "UCaaaaaaaa")
        by_id = {r["browseId"]: r for r in out["artists"][0]["releases"]}
        self.assertEqual(by_id["MPREb_album0001AAA"]["year"], "2026")
        self.assertEqual(by_id["MPREb_album0002BBB"]["year"], "2019")
        self.assertIsNone(by_id["MPREb_single003EEE"]["year"])

    def test_item_without_browse_id_is_dropped(self):
        _, out, _ = self.run_cmd(StubYT(), "UCaaaaaaaa", explore=True)
        titles = [r["title"] for r in out["artists"][0]["releases"]]
        self.assertNotIn("Bez ID-a", titles)
        self.assertEqual(len(titles), 5)
        self.assertNotIn("Bez browseId", [e["title"] for e in out["explore"]])

    def test_explore_items(self):
        _, out, _ = self.run_cmd(StubYT(), "", explore=True)
        self.assertEqual(out["artists"], [])
        first, second = out["explore"]
        self.assertEqual(first, {
            "browseId": "MPREb_explore001AAA", "title": "Nova pjesma", "type": "Single",
            "artist": "Dragana Mirković", "artistId": "UCdragana00000000000000",
            "artworkUrl": "https://lh3.googleusercontent.com/e1=w226-h226"})
        self.assertEqual((second["artist"], second["artistId"]), ("Miroslav Škoro", "UCskoro0000000000000000"))

    def test_explore_not_asked_is_null(self):
        yt = StubYT()
        _, out, _ = self.run_cmd(yt, "UCaaaaaaaa")
        self.assertIsNone(out["explore"])
        self.assertNotIn(("get_explore",), yt.calls)

    def test_duplicate_and_blank_ids_collapse(self):
        yt = StubYT()
        self.run_cmd(yt, "UCa, UCb,,UCa")
        self.assertEqual(yt.calls, [("get_artist", "UCa"), ("get_artist", "UCb")])

    def test_nothing_asked_answers_empty_without_a_call(self):
        yt = StubYT()
        code, out, _ = self.run_cmd(yt, "")
        self.assertEqual(code, 0)
        self.assertEqual(out, {"artists": [], "explore": None, "failed": []})
        self.assertEqual(yt.calls, [])


class Pacing(Base):
    def test_one_sleep_between_every_two_calls_and_none_before_the_first(self):
        yt = StubYT()
        self.run_cmd(yt, "UCa,UCb,UCc", explore=True)
        self.assertEqual(len(yt.calls), 4)
        self.assertEqual(self.sleeps, [player.CHART_FETCH_PACING_SEC] * 3)

    def test_a_single_call_never_sleeps(self):
        self.run_cmd(StubYT(), "UCa")
        self.assertEqual(self.sleeps, [])

    def test_get_artist_once_per_artist_and_never_search(self):
        yt = StubYT()
        self.run_cmd(yt, "UCa,UCb")
        self.assertEqual(yt.calls, [("get_artist", "UCa"), ("get_artist", "UCb")])


class Failures(Base):
    def test_failing_artist_is_named_and_the_rest_come_back(self):
        yt = StubYT(fail={"UCb": RuntimeError("HTTP 503")})
        code, out, _ = self.run_cmd(yt, "UCa,UCb,UCc")
        self.assertEqual(code, 0)
        self.assertEqual([a["id"] for a in out["artists"]], ["UCa", "UCc"])
        self.assertEqual(out["failed"], ["UCb"])

    def test_missing_page_fails_without_a_raw_browse(self):
        yt = StubYT(fail={"UCa": RuntimeError("Unable to find 'contents' using path ['contents', 'x']")})
        _, out, _ = self.run_cmd(yt, "UCa,UCb")
        self.assertEqual(out["failed"], ["UCa"])
        self.assertNotIn(("browse", "UCa"), yt.calls)

    def test_explore_failing_gives_null_and_is_named(self):
        yt = StubYT(explore_error=RuntimeError("HTTP 503"))
        code, out, _ = self.run_cmd(yt, "UCa", explore=True)
        self.assertEqual(code, 0)
        self.assertIsNone(out["explore"])
        self.assertEqual(out["failed"], ["explore"])
        self.assertEqual(len(out["artists"]), 1)

    def test_everything_failing_exits_1(self):
        err = RuntimeError("HTTP 503")
        yt = StubYT(fail={"UCa": err, "UCb": err}, explore_error=err)
        code, out, stderr = self.run_cmd(yt, "UCa,UCb", explore=True)
        self.assertEqual(code, 1)
        self.assertIsNone(out)
        self.assertIn("nothing came back", stderr)

    def test_explore_alone_failing_exits_1(self):
        code, _, _ = self.run_cmd(StubYT(explore_error=RuntimeError("x")), "", explore=True)
        self.assertEqual(code, 1)

    def test_explore_only_with_no_artists_succeeds(self):
        code, out, _ = self.run_cmd(StubYT(), "", explore=True)
        self.assertEqual(code, 0)
        self.assertEqual(len(out["explore"]), 2)


class LayoutError(Base):
    def test_layout_error_takes_one_raw_browse_and_is_paced(self):
        yt = StubYT(fail={"UCb": LAYOUT_ERROR}, browse=load(BROWSE))
        yt.parser.parse_channel_contents.return_value = {
            "albums": {"results": [{"title": "X", "year": "2026", "browseId": "MPREb_rawalbum0001", "thumbnails": []}]}}
        code, out, _ = self.run_cmd(yt, "UCa,UCb")
        self.assertEqual(code, 0)
        self.assertEqual(yt.calls, [("get_artist", "UCa"), ("get_artist", "UCb"), ("browse", "UCb")])
        self.assertEqual(self.sleeps, [player.CHART_FETCH_PACING_SEC] * 2)
        raw = out["artists"][1]
        self.assertEqual(raw["name"], "Syahrul Ramadan")
        self.assertEqual(raw["releases"][0]["type"], "Album")
        self.assertEqual(out["failed"], [])

    def test_layout_error_never_reaches_the_search_fallback(self):
        yt = StubYT(fail={"UCa": LAYOUT_ERROR}, browse=None)
        _, out, _ = self.run_cmd(yt, "UCa")
        self.assertEqual(out, None)
        self.assertNotIn(("search",), yt.calls)

    def test_unparsable_raw_browse_is_a_failure(self):
        yt = StubYT(fail={"UCa": LAYOUT_ERROR}, browse={"header": {}})
        _, out, _ = self.run_cmd(yt, "UCa,UCb")
        self.assertEqual(out["failed"], ["UCa"])
        self.assertEqual([a["id"] for a in out["artists"]], ["UCb"])


class ArtistPageUnchanged(unittest.TestCase):
    def test_release_json_without_a_type_keeps_the_artist_page_shape(self):
        item = {"browseId": "MPREb_x", "title": "T", "year": "2020", "thumbnails": [{"url": "u"}], "type": "EP"}
        self.assertEqual(player.release_json(item),
                         {"browseId": "MPREb_x", "title": "T", "year": "2020", "thumbnails": [{"url": "u"}]})


if __name__ == "__main__":
    unittest.main()
