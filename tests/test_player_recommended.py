"""player.py `recommended`: the CLI must accept a hyphen-leading seed
videoId (e.g. "-UaaeSP971U" or "-kPEbV8T35k" — both real YouTube ids seen in
production). Passed as `--seed <id>` (a space, two argv tokens), argparse
reads the hyphen-leading id as another option and exits 2 before
cmd_recommended ever runs, which is exactly the bug this guards against:

    .venv/bin/python -m unittest tests/test_player_recommended.py

No network: YTMusic is replaced before player.py is imported, same as
test_player_match.py.
"""
import argparse
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent

os.environ["MUSIC_DIR"] = tempfile.mkdtemp(prefix="ember-recommended-test-")
sys.path.insert(0, str(ROOT))
with mock.patch("ytmusicapi.YTMusic"):
    import player  # noqa: E402

HYPHEN_SEED = "-UaaeSP971U"


class RecommendedCliParsingTest(unittest.TestCase):
    """Exercises player.py's actual argparse setup (main()'s parser), not a
    reimplementation of it, so a future change to p_rec's arguments is
    caught here too."""

    def setUp(self):
        self.yt = mock.MagicMock()
        # One related track back, so cmd_recommended has something to print
        # without falling through to the chart fallback.
        self.yt.get_watch_playlist.return_value = {
            "tracks": [
                {"videoId": HYPHEN_SEED, "title": "seed", "artists": [{"name": "A"}]},
                {
                    "videoId": "dQw4w9WgXcQ",
                    "title": "Related Song",
                    "artists": [{"name": "Someone"}],
                    "album": {"name": "Album"},
                    "duration_seconds": 200,
                    "thumbnails": [{"url": "http://example.com/a.jpg"}],
                },
            ]
        }
        patcher = mock.patch.object(player, "yt", self.yt)
        patcher.start()
        self.addCleanup(patcher.stop)

    def run_cli(self, argv):
        out = io.StringIO()
        with mock.patch.object(sys, "argv", ["player.py", *argv]), redirect_stdout(out):
            player.main()
        return out.getvalue()

    def test_seed_equals_form_accepted_and_used(self):
        """The exact form the web app now sends: --seed=<id>."""
        stdout = self.run_cli(["recommended", "--country", "ZZ", "--limit", "30", f"--seed={HYPHEN_SEED}"])
        self.yt.get_watch_playlist.assert_called_once()
        _, kwargs = self.yt.get_watch_playlist.call_args
        self.assertEqual(kwargs["videoId"], HYPHEN_SEED)
        tracks = json.loads(stdout)
        self.assertEqual([t["videoId"] for t in tracks], ["dQw4w9WgXcQ"])

    def test_seed_space_form_with_hyphen_id_fails_argparse(self):
        """Documents the actual production bug: the old `--seed <id>` form
        (two argv tokens) makes argparse treat a hyphen-leading id as
        another option and exit(2) before cmd_recommended runs at all."""
        with self.assertRaises(SystemExit) as ctx:
            with mock.patch.object(sys, "argv", ["player.py", "recommended", "--seed", HYPHEN_SEED]):
                with redirect_stdout(io.StringIO()):
                    player.main()
        self.assertEqual(ctx.exception.code, 2)
        self.yt.get_watch_playlist.assert_not_called()

    def test_ordinary_seed_still_works_via_equals_form(self):
        ordinary = "dQw4w9WgXcQ"
        self.yt.get_watch_playlist.return_value = {
            "tracks": [
                {"videoId": ordinary, "title": "seed", "artists": [{"name": "A"}]},
                {"videoId": "abc12345678", "title": "Other", "artists": [{"name": "B"}]},
            ]
        }
        stdout = self.run_cli(["recommended", f"--seed={ordinary}"])
        self.yt.get_watch_playlist.assert_called_once()
        self.assertEqual([t["videoId"] for t in json.loads(stdout)], ["abc12345678"])


class RecommendedHandlerTest(unittest.TestCase):
    """Direct unit test of cmd_recommended, independent of argparse, the way
    test_player_match.py exercises cmd_match."""

    def setUp(self):
        self.yt = mock.MagicMock()
        patcher = mock.patch.object(player, "yt", self.yt)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_hyphen_seed_is_used_verbatim_and_filtered_from_results(self):
        self.yt.get_watch_playlist.return_value = {
            "tracks": [
                {"videoId": HYPHEN_SEED, "title": "seed", "artists": [{"name": "A"}]},
                {
                    "videoId": "abc12345678",
                    "title": "Other",
                    "artists": [{"name": "B"}],
                    "album": {"name": "Album"},
                    "duration_seconds": 180,
                    "thumbnails": [{"url": "http://example.com/b.jpg"}],
                },
            ]
        }
        out = io.StringIO()
        with redirect_stdout(out):
            player.cmd_recommended(argparse.Namespace(seed=HYPHEN_SEED, limit=30, country="ZZ"))
        _, kwargs = self.yt.get_watch_playlist.call_args
        self.assertEqual(kwargs["videoId"], HYPHEN_SEED)
        tracks = json.loads(out.getvalue())
        self.assertEqual([t["videoId"] for t in tracks], ["abc12345678"])


if __name__ == "__main__":
    unittest.main()
