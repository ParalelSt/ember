"""player.py `album` / `artist` failures: a short message and a reason the
web app maps to 404 or 502, never ytmusicapi's raw response dump. The
not-found error is the real one from a live `player.py album --
MPREb_zzzzzzzzzzz` on 2026-09-24. No network: YTMusic is replaced.

    .venv/bin/python -m unittest tests/test_player_browse.py
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

import requests
from ytmusicapi.exceptions import YTMusicServerError

ROOT = Path(__file__).resolve().parent.parent

os.environ["MUSIC_DIR"] = tempfile.mkdtemp(prefix="ember-browse-test-")
sys.path.insert(0, str(ROOT))
with mock.patch("ytmusicapi.YTMusic"):
    import player  # noqa: E402

RESPONSE_DUMP = (
    "{'responseContext': {'serviceTrackingParams': [{'service': 'GFEEDBACK', 'params': "
    "[{'key': 'browse_id', 'value': 'MPREb_zzzzzzzzzzz'}, {'key': 'browse_id_prefix', 'value': ''}, "
    "{'key': 'has_unlimited_entitlement', 'value': 'False'}, {'key': 'logged_in', 'value': '0'}]}, "
    "{'service': 'CSI', 'params': [{'key': 'c', 'value': 'WEB_REMIX'}, {'key': 'cver', 'value': "
    "'1.20260923.01.00'}, {'key': 'yt_li', 'value': '0'}, {'key': 'GetBrowseAlbumDetailPage_rid', "
    "'value': '0x416ef20bbd4eae97'}]}, {'service': 'ECATCHER', 'params': [{'key': 'client.version', "
    "'value': '1.20000101'}, {'key': 'client.name', 'value': 'WEB_REMIX'}]}], 'responseId': "
    "'IhMIs8rUz-WFlwMVOS1zCR3SxAQm'}, 'trackingParams': 'CAAQhGciEwizytTP5YWXAxU5LXMJHdLEBCbKAQQFXOtO', "
    "'microformat': {'microformatDataRenderer': {'noindex': True}}}"
)
ALBUM_MISSING = KeyError(
    "Unable to find 'contents' using path ['contents', 'twoColumnBrowseResultsRenderer', 'tabs', 0, "
    "'tabRenderer', 'content', 'sectionListRenderer', 'contents', 0, 'musicResponsiveHeaderRenderer'] "
    f"on {RESPONSE_DUMP}, exception: 'contents'"
)
ARTIST_MISSING = KeyError(
    "Unable to find 'contents' using path ['contents', 'twoColumnBrowseResultsRenderer', 'tabs', 0, "
    "'tabRenderer', 'content', 'sectionListRenderer', 'contents'] "
    f"on {RESPONSE_DUMP}, exception: 'contents'"
)


def run(cmd, **kwargs):
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        cmd(argparse.Namespace(**kwargs))
    return json.loads(out.getvalue()), err.getvalue()


class BrowseErrorTest(unittest.TestCase):
    def setUp(self):
        self.yt = mock.MagicMock()
        p = mock.patch.object(player, "yt", self.yt)
        p.start()
        self.addCleanup(p.stop)

    def assert_short(self, res):
        self.assertLess(len(res["error"]), 120)
        self.assertNotIn("responseContext", res["error"])
        self.assertNotIn("Unable to find", res["error"])

    def test_missing_album_is_not_found_and_short(self):
        self.yt.get_album.side_effect = ALBUM_MISSING
        res, err = run(player.cmd_album, browse_id="MPREb_zzzzzzzzzzz")
        self.assert_short(res)
        self.assertEqual(res["reason"], "not-found")
        # The full detail still reaches the server log.
        self.assertIn("responseContext", err)

    def test_missing_artist_is_not_found_and_short(self):
        self.yt.get_artist.side_effect = ARTIST_MISSING
        res, _ = run(player.cmd_artist, channel_id="UCzzzzzzzzzzzzzzzzzzzzzz")
        self.assert_short(res)
        self.assertEqual(res["reason"], "not-found")

    def test_http_404_is_not_found(self):
        self.yt.get_album.side_effect = YTMusicServerError("Server returned HTTP 404: Not Found.\nRequested entity was not found.")
        res, _ = run(player.cmd_album, browse_id="MPREb_zzzzzzzzzzz")
        self.assertEqual(res["reason"], "not-found")

    def test_outage_or_layout_change_is_failed(self):
        deeper = KeyError("Unable to find 'musicResponsiveHeaderRenderer' using path ['contents', "
                          f"'twoColumnBrowseResultsRenderer'] on {RESPONSE_DUMP}, exception: 'x'")
        for e in (requests.exceptions.ConnectionError("Connection aborted."),
                  YTMusicServerError("Server returned HTTP 503: Service Unavailable.\nBackend Error"),
                  deeper):
            self.yt.get_album.side_effect = e
            self.yt.get_artist.side_effect = e
            for cmd, kw in ((player.cmd_album, {"browse_id": "MPREb_zzzzzzzzzzz"}),
                            (player.cmd_artist, {"channel_id": "UCzzzzzzzzzzzzzzzzzzzzzz"})):
                res, _ = run(cmd, **kw)
                self.assert_short(res)
                self.assertEqual(res["reason"], "failed")


if __name__ == "__main__":
    unittest.main()
