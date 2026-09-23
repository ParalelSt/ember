"""player.py `classify`: YouTube Music's own type for each liked video, from
saved get_song output (tests/fixtures/imports/ytm-get-song-liked16.json, the
owner's 16 real likes, recorded 2026-09-23). No network: YTMusic is replaced
before player.py is imported.

    .venv/bin/python -m unittest tests/test_player_classify.py
"""
import argparse
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "tests" / "fixtures" / "imports" / "ytm-get-song-liked16.json"

os.environ["MUSIC_DIR"] = tempfile.mkdtemp(prefix="ember-classify-test-")
sys.path.insert(0, str(ROOT))
with mock.patch("ytmusicapi.YTMusic"):
    import player  # noqa: E402


def run_classify(ids):
    out = io.StringIO()
    with redirect_stdout(out), redirect_stderr(io.StringIO()):
        player.cmd_classify(argparse.Namespace(video_ids=ids))
    return json.loads(out.getvalue())


def song_response(entry):
    """A get_song answer shaped like the real one, with only the fields the
    fixture kept. An unplayable video still has videoDetails, just no type."""
    details = {"videoId": entry["videoId"], "title": entry["title"], "author": entry["author"]}
    if entry["musicVideoType"]:
        details["musicVideoType"] = entry["musicVideoType"]
    return {"playabilityStatus": {"status": entry["playability"]}, "videoDetails": details}


class ClassifyTest(unittest.TestCase):
    def setUp(self):
        self.songs = json.loads(FIXTURE.read_text())["songs"]
        by_id = {s["videoId"]: song_response(s) for s in self.songs}
        self.yt = mock.MagicMock()
        self.yt.get_song.side_effect = lambda vid: by_id[vid]
        patcher = mock.patch.object(player, "yt", self.yt)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_the_owners_sixteen_likes(self):
        ids = [s["videoId"] for s in self.songs]
        res = run_classify(ids)
        types = res["results"]
        self.assertEqual(list(types), ids)
        self.assertEqual(sorted(v for v in types.values() if v == "ATV"), ["ATV"] * 4)
        self.assertEqual([k for k, v in types.items() if v == "OMV"], ["GpjwBVKPQCM"])
        self.assertEqual(len([v for v in types.values() if v == "UGC"]), 5)
        self.assertEqual(len([v for v in types.values() if v is None]), 6)
        self.assertEqual(types["16GpicX09gk"], "ATV")  # Maneskin, ZITTI E BUONI
        self.assertIsNone(types["_VH9rmJU8tM"])  # the Minecraft video
        self.assertEqual(res["failed"], [])
        self.assertIs(res["busy"], False)

    def test_one_batch_is_one_lookup_per_id_in_order(self):
        ids = ["16GpicX09gk", "gZjdAWgjLx8", "LHvx1FIciSM"]
        res = run_classify(ids)
        self.assertEqual([c.args[0] for c in self.yt.get_song.call_args_list], ids)
        self.assertEqual(res["results"], {"16GpicX09gk": "ATV", "gZjdAWgjLx8": "UGC", "LHvx1FIciSM": None})

    def test_missing_video_type_is_null(self):
        self.yt.get_song.side_effect = [{"videoDetails": {"videoId": "aaaaaaaaaaa"}}, {}, None]
        res = run_classify(["aaaaaaaaaaa", "bbbbbbbbbbb", "ccccccccccc"])
        self.assertEqual(res["results"], {"aaaaaaaaaaa": None, "bbbbbbbbbbb": None, "ccccccccccc": None})
        self.assertEqual(res["failed"], [])

    def test_an_unknown_type_is_null(self):
        self.yt.get_song.side_effect = [{"videoDetails": {"musicVideoType": "MUSIC_VIDEO_TYPE_PODCAST_EPISODE"}}]
        self.assertEqual(run_classify(["aaaaaaaaaaa"])["results"], {"aaaaaaaaaaa": None})

    def test_an_error_for_one_id_leaves_the_rest(self):
        ok = song_response(self.songs[2])
        self.yt.get_song.side_effect = [ok, KeyError("videoDetails"), ok]
        res = run_classify(["16GpicX09gk", "bbbbbbbbbbb", "ccccccccccc"])
        self.assertEqual(res["results"], {"16GpicX09gk": "ATV", "bbbbbbbbbbb": None, "ccccccccccc": "ATV"})
        self.assertEqual(res["failed"], ["bbbbbbbbbbb"])
        self.assertIs(res["busy"], False)

    def test_too_fast_stops_the_batch_and_says_busy(self):
        ok = song_response(self.songs[2])
        self.yt.get_song.side_effect = [ok, Exception("Server returned HTTP 429: Too Many Requests."), ok]
        res = run_classify(["16GpicX09gk", "bbbbbbbbbbb", "ccccccccccc"])
        self.assertIs(res["busy"], True)
        self.assertEqual(self.yt.get_song.call_count, 2)
        self.assertEqual(res["results"], {"16GpicX09gk": "ATV"})

    def test_network_error_stops_the_batch_and_says_busy(self):
        # A network error says nothing about the video itself: it must not
        # be counted as "not music" the way a real lookup failure is.
        ok = song_response(self.songs[2])
        import requests

        self.yt.get_song.side_effect = [ok, requests.exceptions.ConnectionError("Failed to establish a new connection"), ok]
        res = run_classify(["16GpicX09gk", "bbbbbbbbbbb", "ccccccccccc"])
        self.assertIs(res["busy"], True)
        self.assertEqual(self.yt.get_song.call_count, 2)
        self.assertEqual(res["results"], {"16GpicX09gk": "ATV"})
        self.assertEqual(res["failed"], [])

    def test_server_error_stops_the_batch_and_says_busy(self):
        # 5xx without the "too many requests"/rate-limit wording BUSY_RE
        # looked for is still YouTube Music being unavailable, not the video
        # being unplayable.
        ok = song_response(self.songs[2])
        self.yt.get_song.side_effect = [ok, Exception("Server returned HTTP 500: Internal Server Error."), ok]
        res = run_classify(["16GpicX09gk", "bbbbbbbbbbb", "ccccccccccc"])
        self.assertIs(res["busy"], True)
        self.assertEqual(self.yt.get_song.call_count, 2)
        self.assertEqual(res["results"], {"16GpicX09gk": "ATV"})
        self.assertEqual(res["failed"], [])

    def test_a_malformed_id_is_never_looked_up(self):
        res = run_classify(["../etc", "16GpicX09gk"])
        self.assertEqual(res["results"]["../etc"], None)
        self.assertEqual(res["failed"], ["../etc"])
        self.assertEqual([c.args[0] for c in self.yt.get_song.call_args_list], ["16GpicX09gk"])

    def test_cli_wiring(self):
        with mock.patch.object(sys, "argv", ["player.py", "classify", "--", "16GpicX09gk", "GpjwBVKPQCM"]):
            out = io.StringIO()
            with redirect_stdout(out):
                player.main()
        self.assertEqual(json.loads(out.getvalue())["results"], {"16GpicX09gk": "ATV", "GpjwBVKPQCM": "OMV"})


if __name__ == "__main__":
    unittest.main()
