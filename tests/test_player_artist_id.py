"""player.py `artist-id`: exact-name YT Music artist lookup. No network.

    .venv/bin/python -m unittest tests/test_player_artist_id.py
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
os.environ["MUSIC_DIR"] = tempfile.mkdtemp(prefix="ember-artist-id-test-")
sys.path.insert(0, str(ROOT))
with mock.patch("ytmusicapi.YTMusic"):
    import player  # noqa: E402


def run(name, hits=None, error=None):
    out, err = io.StringIO(), io.StringIO()
    search = mock.Mock(side_effect=error) if error else mock.Mock(return_value=hits)
    with mock.patch.object(player.yt, "search", search), redirect_stdout(out), redirect_stderr(err):
        player.cmd_artist_id(argparse.Namespace(name=name))
    return json.loads(out.getvalue())


class ArtistId(unittest.TestCase):
    def test_exact_name_wins_over_first_hit(self):
        hits = [{"artist": "Peki Band", "browseId": "UC1"}, {"artist": "Peki", "browseId": "UC2"}]
        self.assertEqual(run("Peki", hits), {"id": "UC2"})

    def test_case_and_diacritics_insensitive(self):
        self.assertEqual(run("beyonce", [{"artist": "Beyoncé", "browseId": "UCb"}]), {"id": "UCb"})

    def test_no_match_is_null(self):
        self.assertEqual(run("Peki", [{"artist": "Other", "browseId": "UC1"}]), {"id": None})

    def test_search_failure_is_null(self):
        self.assertEqual(run("Peki", error=RuntimeError("503")), {"id": None})


if __name__ == "__main__":
    unittest.main()
