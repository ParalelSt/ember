"""player.py's length/size caps on downloads: none by default (removed
2026-09-26, the host is friends only), opt-in via EMBER_MAX_TRACK_MINUTES /
EMBER_MAX_DOWNLOAD_MB, and a live stream is always refused since it has no
end to reach. No network: yt_dlp.YoutubeDL is replaced before player.py is
imported, and the fake calls the match_filter the way yt-dlp does.

    .venv/bin/python -m unittest tests/test_player_download_limits.py
"""
import io
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent

os.environ["MUSIC_DIR"] = tempfile.mkdtemp(prefix="ember-limits-test-")
sys.path.insert(0, str(ROOT))
with mock.patch("ytmusicapi.YTMusic"):
    import player  # noqa: E402

VIDEO = "limitsvid01"


class FakeYDL:
    """Stands in for yt_dlp.YoutubeDL: runs the match_filter on the facts
    before and after format selection, as yt-dlp does, and only then writes
    the file. `write` False mimics yt-dlp skipping a file over max_filesize."""

    last_opts = None

    def __init__(self, facts, fmt=None, write=True):
        self.facts, self.fmt, self.write = facts, fmt or {}, write

    def __call__(self, opts):
        FakeYDL.last_opts = opts
        self.opts = opts
        return self

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def extract_info(self, url):
        info = {"id": VIDEO, "ext": "m4a", **self.facts}
        self.opts["match_filter"](info, incomplete=True)
        info.update(self.fmt)
        self.opts["match_filter"](info, incomplete=False)
        if self.write:
            (player.MUSIC_DIR / f"{VIDEO}.m4a").write_bytes(b"audio")
        return info

    def prepare_filename(self, info):
        return str(player.MUSIC_DIR / f"{VIDEO}.m4a")


class LimitsTest(unittest.TestCase):
    def setUp(self):
        for p in player.MUSIC_DIR.glob(f"{VIDEO}*"):
            p.unlink()
        self.env = mock.patch.dict(os.environ, {"EMBER_MAX_TRACK_MINUTES": "", "EMBER_MAX_DOWNLOAD_MB": ""})
        self.env.start()
        self.addCleanup(self.env.stop)

    def run_download(self, fake):
        with mock.patch.object(player.yt_dlp, "YoutubeDL", fake):
            return player.download_by_id(VIDEO)

    def test_a_normal_song_downloads(self):
        path = self.run_download(FakeYDL({"duration": 240}, {"filesize": 4_000_000}))
        self.assertTrue(path.exists())
        # No cap by default: yt-dlp gets no max_filesize at all.
        self.assertIsNone(FakeYDL.last_opts["max_filesize"])

    def test_an_hour_long_video_downloads_with_no_cap_set(self):
        path = self.run_download(FakeYDL({"duration": 3600}, {"filesize": 200 * 1024 * 1024}))
        self.assertTrue(path.exists())

    def test_a_live_stream_is_refused_even_with_no_cap(self):
        with self.assertRaisesRegex(player.TooLargeError, r"^too long: live"):
            self.run_download(FakeYDL({"live_status": "is_live"}))

    def test_the_caps_are_off_by_default(self):
        self.assertEqual(player.media_limits(), (0, 0))

    def test_an_hour_long_video_is_refused_once_the_env_opts_in(self):
        os.environ["EMBER_MAX_TRACK_MINUTES"] = "20"
        with self.assertRaisesRegex(player.TooLargeError, r"^too long: 60 min is over the 20 min limit"):
            self.run_download(FakeYDL({"duration": 3600}))
        self.assertFalse((player.MUSIC_DIR / f"{VIDEO}.m4a").exists())

    def test_a_huge_format_is_refused_once_the_env_opts_in(self):
        os.environ["EMBER_MAX_DOWNLOAD_MB"] = "60"
        with self.assertRaisesRegex(player.TooLargeError, r"^too large"):
            self.run_download(FakeYDL({"duration": 600}, {"filesize_approx": 200 * 1024 * 1024}))
        self.assertFalse((player.MUSIC_DIR / f"{VIDEO}.m4a").exists())

    def test_a_download_yt_dlp_skipped_for_size_is_refused_once_opted_in(self):
        os.environ["EMBER_MAX_DOWNLOAD_MB"] = "60"
        with self.assertRaisesRegex(player.TooLargeError, r"^too large"):
            self.run_download(FakeYDL({"duration": 600}, write=False))

    def test_the_opted_in_caps_follow_the_env(self):
        os.environ["EMBER_MAX_TRACK_MINUTES"] = "90"
        os.environ["EMBER_MAX_DOWNLOAD_MB"] = "300"
        path = self.run_download(FakeYDL({"duration": 3600}, {"filesize": 100 * 1024 * 1024}))
        self.assertTrue(path.exists())

    def test_cmd_download_prints_one_error_line_and_fails_for_a_live_stream(self):
        err = io.StringIO()
        with mock.patch.object(player.yt_dlp, "YoutubeDL", FakeYDL({"live_status": "is_live"})):
            with redirect_stderr(err), redirect_stdout(io.StringIO()):
                with self.assertRaises(SystemExit) as exit_:
                    player.cmd_download(SimpleNamespace(video_id=VIDEO))
        self.assertEqual(exit_.exception.code, 1)
        self.assertIn("ERROR: too long: live streams cannot be played", err.getvalue())


if __name__ == "__main__":
    unittest.main()
