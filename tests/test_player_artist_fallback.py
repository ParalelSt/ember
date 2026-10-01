"""player.py `artist` when ytmusicapi's get_artist can't parse the page.

YouTube serves some artist pages with a different header renderer, so
get_artist raises KeyError 'musicImmersiveHeaderRenderer' (real case:
UCO4Yr3Y6-CUCTBy8m0Hlhrw, "Syahrul Ramadan", a musicVisualHeaderRenderer page).
The fixture is that real browse response trimmed to metadata. No network.

    .venv/bin/python -m unittest tests/test_player_artist_fallback.py
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
FIXTURE = json.loads((ROOT / "tests/fixtures/artist/browse-visual-header.json").read_text())
CID = "UCO4Yr3Y6-CUCTBy8m0Hlhrw"

os.environ["MUSIC_DIR"] = tempfile.mkdtemp(prefix="ember-artist-test-")
sys.path.insert(0, str(ROOT))
with mock.patch("ytmusicapi.YTMusic"):
    import player  # noqa: E402

HEADER_KEY_ERROR = KeyError("musicImmersiveHeaderRenderer")


def run(channel_id=CID):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        player.cmd_artist(argparse.Namespace(channel_id=channel_id))
    return json.loads(out.getvalue()), err.getvalue()


def with_header(kind, **extra):
    """The fixture with its header stored under another renderer name."""
    r = copy.deepcopy(FIXTURE)
    body = r["header"].pop("musicVisualHeaderRenderer")
    body.update(extra)
    r["header"] = {kind: body}
    return r


class ParseHeaderVariants(unittest.TestCase):
    def test_visual_header_real_fixture(self):
        info = player.artist_from_browse(FIXTURE)
        self.assertEqual(info["name"], "Syahrul Ramadan")
        # square avatar preferred over the wide banner
        self.assertEqual(info["thumbnails"][-1]["width"], 544)

    def test_other_header_renderers(self):
        for kind in ("musicImmersiveHeaderRenderer", "musicResponsiveHeaderRenderer",
                     "musicDetailHeaderRenderer", "someFutureHeaderRenderer"):
            with self.subTest(kind=kind):
                info = player.artist_from_browse(with_header(kind))
                self.assertEqual(info["name"], "Syahrul Ramadan")
                self.assertTrue(info["thumbnails"])

    def test_banner_only_thumbnail(self):
        r = with_header("musicImmersiveHeaderRenderer")
        del r["header"]["musicImmersiveHeaderRenderer"]["foregroundThumbnail"]
        info = player.artist_from_browse(r)
        self.assertEqual(info["thumbnails"][-1]["width"], 2048)

    def test_header_description(self):
        r = with_header("musicResponsiveHeaderRenderer", description={"runs": [{"text": "Hi "}, {"text": "there"}]})
        self.assertEqual(player.artist_from_browse(r)["description"], "Hi there")

    def test_description_shelf_in_contents(self):
        r = copy.deepcopy(FIXTURE)
        sections = r["contents"]["singleColumnBrowseResultsRenderer"]["tabs"][0]["tabRenderer"]["content"]["sectionListRenderer"]["contents"]
        sections.append({"musicDescriptionShelfRenderer": {"description": {"runs": [{"text": "About me"}]}}})
        self.assertEqual(player.artist_from_browse(r)["description"], "About me")

    def test_no_header_or_no_name(self):
        self.assertIsNone(player.artist_from_browse({"contents": {}}))
        self.assertIsNone(player.artist_from_browse({"header": {"xRenderer": {"title": {"runs": []}}}}))


class ArtistCommandFallback(unittest.TestCase):
    def setUp(self):
        self.yt = mock.MagicMock()
        p = mock.patch.object(player, "yt", self.yt)
        p.start()
        self.addCleanup(p.stop)
        self.yt.get_artist.side_effect = HEADER_KEY_ERROR
        self.yt._send_request.return_value = FIXTURE
        self.yt.search.return_value = []

    def test_recovers_from_header_keyerror(self):
        data, err = run()
        self.assertNotIn("error", data)
        self.assertEqual(data["name"], "Syahrul Ramadan")
        self.assertTrue(data["thumbnails"])
        self.assertEqual(data["tracks"], [])
        self.assertEqual((data["albums"], data["singles"]), ([], []))
        self.yt._send_request.assert_called_once_with("browse", {"browseId": CID})
        self.assertIn("artist failed", err)

    def test_songs_come_from_channel_filtered_search(self):
        self.yt.search.return_value = [
            {"videoId": "mine", "title": "A", "artists": [{"name": "Syahrul Ramadan", "id": CID}]},
            {"videoId": "other", "title": "B", "artists": [{"name": "Syahrul Ramadan", "id": "UCother"}]},
        ]
        data, _ = run()
        self.assertEqual([t["videoId"] for t in data["tracks"]], ["mine"])

    def test_raw_browse_fails_too_is_plain_failure(self):
        self.yt._send_request.side_effect = RuntimeError("boom")
        data, _ = run()
        # No page to read a name from: plain failure, not a crash.
        self.assertEqual(data["reason"], "failed")

    def test_no_header_uses_microformat_and_artists_search(self):
        raw = copy.deepcopy(FIXTURE)
        raw["header"] = {}
        self.yt._send_request.return_value = raw
        self.yt.search.side_effect = lambda q, filter=None, limit=None: (
            [{"browseId": CID, "artist": "Syahrul Ramadan", "thumbnails": [{"url": "u", "width": 1, "height": 1}]}]
            if filter == "artists" else [])
        data, _ = run()
        self.assertEqual(data["name"], "Syahrul Ramadan")
        self.assertEqual(data["thumbnails"][0]["url"], "u")

    def test_no_header_search_down_keeps_microformat_name(self):
        raw = copy.deepcopy(FIXTURE)
        raw["header"] = {}
        self.yt._send_request.return_value = raw
        self.yt.search.side_effect = RuntimeError("down")
        data, _ = run()
        self.assertEqual(data["name"], "Syahrul Ramadan")
        self.assertTrue(data["thumbnails"])

    def test_missing_page_stays_not_found_without_fallback(self):
        self.yt.get_artist.side_effect = KeyError(
            "Unable to find 'contents' using path ['contents', 'twoColumnBrowseResultsRenderer', 'tabs', 0] on {}")
        data, _ = run()
        self.assertEqual(data["reason"], "not-found")
        self.yt._send_request.assert_not_called()

    def test_normal_path_untouched(self):
        self.yt.get_artist.side_effect = None
        self.yt.get_artist.return_value = {"name": "Normal", "description": "d", "thumbnails": [], "songs": {}, "albums": {"results": []}}
        data, _ = run()
        self.assertEqual(data["name"], "Normal")
        self.yt._send_request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
