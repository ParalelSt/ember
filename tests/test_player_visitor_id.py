"""player.py keeps ytmusicapi's anonymous visitor id between runs, so a fresh
helper process skips the home-page fetch it would otherwise make first:

    .venv/bin/python -m unittest tests/test_player_visitor_id.py

No network: YTMusic is replaced before player.py is imported.
"""
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent

os.environ["MUSIC_DIR"] = tempfile.mkdtemp(prefix="ember-visitor-test-")
sys.path.insert(0, str(ROOT))
with mock.patch("ytmusicapi.YTMusic"):
    import player  # noqa: E402


class FakeClient:
    """Stands in for YTMusic: base_headers is only a plain attribute here."""


class VisitorIdTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="ember-visitor-"))
        self.file = self.dir / "v.json"
        player._visitor_seeded = False

    def test_fresh_file_seeds_the_client_without_a_fetch(self):
        player._save_visitor_id("VID123", self.file, now=1000)
        c = FakeClient()
        self.assertTrue(player.seed_visitor_id(c, self.file, now=1000 + 60))
        self.assertEqual(c.__dict__["base_headers"]["X-Goog-Visitor-Id"], "VID123")

    def test_stale_file_is_ignored(self):
        player._save_visitor_id("OLD", self.file, now=1000)
        c = FakeClient()
        later = 1000 + player.VISITOR_ID_TTL_SEC + 1
        self.assertFalse(player.seed_visitor_id(c, self.file, now=later))
        self.assertNotIn("base_headers", c.__dict__)

    def test_missing_or_garbage_file_is_ignored(self):
        c = FakeClient()
        self.assertFalse(player.seed_visitor_id(c, self.file))
        self.file.write_text("not json")
        self.assertFalse(player.seed_visitor_id(c, self.file))

    def test_a_fetched_id_is_saved_for_the_next_run(self):
        c = FakeClient()
        c.__dict__["base_headers"] = {"X-Goog-Visitor-Id": "FETCHED"}
        player._save_fetched_visitor_id(c, self.file, now=5)
        self.assertEqual(json.loads(self.file.read_text())["visitorId"], "FETCHED")

    def test_a_seeded_run_does_not_rewrite_the_file(self):
        player._save_visitor_id("VID", self.file, now=1000)
        player.seed_visitor_id(FakeClient(), self.file, now=1001)
        self.file.unlink()
        c = FakeClient()
        c.__dict__["base_headers"] = {"X-Goog-Visitor-Id": "VID"}
        player._save_fetched_visitor_id(c, self.file)
        self.assertFalse(self.file.exists())

    def test_real_client_takes_the_seed_as_its_base_headers(self):
        from ytmusicapi import YTMusic as Real
        real = Real.__new__(Real)
        player._save_visitor_id("VIDREAL", self.file, now=1000)
        self.assertTrue(player.seed_visitor_id(real, self.file, now=1001))
        self.assertEqual(real.base_headers["X-Goog-Visitor-Id"], "VIDREAL")


if __name__ == "__main__":
    unittest.main()
