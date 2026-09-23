"""player.py `download_by_id` / `download_if_needed`: resilience to YouTube's
intermittent "HTTP Error 403: Forbidden" on the media fetch (signed URLs can
expire or come back invalid on the first try; a retry with a fresh
`extract_info`/`download` call gets new ones). No network: yt_dlp.YoutubeDL
is replaced before player.py is imported.

    .venv/bin/python -m unittest tests/test_player_download_403.py
"""
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent

os.environ["MUSIC_DIR"] = tempfile.mkdtemp(prefix="ember-403-test-")
sys.path.insert(0, str(ROOT))
with mock.patch("ytmusicapi.YTMusic"):
    import player  # noqa: E402

from yt_dlp.utils import DownloadError  # noqa: E402


def _forbidden():
    return DownloadError("ERROR: unable to download video data: HTTP Error 403: Forbidden")


class DownloadByIdTest(unittest.TestCase):
    def setUp(self):
        player.MUSIC_DIR.mkdir(parents=True, exist_ok=True)
        self.video_id = "abcdefghijk"
        self.addCleanup(self._cleanup_files)

    def _cleanup_files(self):
        for p in player.MUSIC_DIR.glob(f"{self.video_id}*"):
            try:
                p.unlink()
            except OSError:
                pass

    def _make_ydl(self, extract_info_side_effect):
        """A mock yt_dlp.YoutubeDL context manager whose extract_info()
        follows the given side_effect list/exception."""
        ydl_cm = mock.MagicMock()
        ydl = ydl_cm.__enter__.return_value
        ydl.extract_info.side_effect = extract_info_side_effect
        ydl.prepare_filename.return_value = str(player.MUSIC_DIR / f"{self.video_id}.m4a")
        return ydl_cm, ydl

    def test_403_then_success_retries_once_and_returns_file(self):
        info = {"id": self.video_id, "ext": "m4a"}
        ydl_cm, ydl = self._make_ydl([_forbidden(), info])
        with mock.patch.object(player.yt_dlp, "YoutubeDL", return_value=ydl_cm):
            result = player.download_by_id(self.video_id)
        self.assertEqual(result, player.MUSIC_DIR / f"{self.video_id}.m4a")
        self.assertEqual(ydl.extract_info.call_count, 2)

    def test_403_twice_raises(self):
        ydl_cm, ydl = self._make_ydl([_forbidden(), _forbidden()])
        with mock.patch.object(player.yt_dlp, "YoutubeDL", return_value=ydl_cm):
            with self.assertRaises(DownloadError):
                player.download_by_id(self.video_id)
        self.assertEqual(ydl.extract_info.call_count, 2)

    def test_non_403_error_does_not_retry(self):
        ydl_cm, ydl = self._make_ydl([DownloadError("ERROR: Video unavailable")])
        with mock.patch.object(player.yt_dlp, "YoutubeDL", return_value=ydl_cm):
            with self.assertRaises(DownloadError):
                player.download_by_id(self.video_id)
        self.assertEqual(ydl.extract_info.call_count, 1)

    def test_403_cleans_part_files_before_retry(self):
        partial = player.MUSIC_DIR / f"{self.video_id}.m4a.part"
        partial.write_bytes(b"partial-data")
        info = {"id": self.video_id, "ext": "m4a"}
        ydl_cm, ydl = self._make_ydl([_forbidden(), info])
        with mock.patch.object(player.yt_dlp, "YoutubeDL", return_value=ydl_cm):
            player.download_by_id(self.video_id)
        self.assertFalse(partial.exists())

    def test_403_twice_still_cleans_part_files(self):
        partial = player.MUSIC_DIR / f"{self.video_id}.m4a.part"
        partial.write_bytes(b"partial-data")
        ydl_cm, ydl = self._make_ydl([_forbidden(), _forbidden()])
        with mock.patch.object(player.yt_dlp, "YoutubeDL", return_value=ydl_cm):
            with self.assertRaises(DownloadError):
                player.download_by_id(self.video_id)
        # Cleaned before the retry attempt, even though that attempt also failed.
        self.assertFalse(partial.exists())

    def test_cached_file_skips_download_entirely(self):
        cached = player.MUSIC_DIR / f"{self.video_id}.m4a"
        cached.write_bytes(b"already-here")
        with mock.patch.object(player.yt_dlp, "YoutubeDL") as ydl_cls:
            result = player.download_by_id(self.video_id)
        ydl_cls.assert_not_called()
        self.assertEqual(result, cached)


class DownloadIfNeededTest(unittest.TestCase):
    def setUp(self):
        self.title = "Test Song 403"
        self.artist = "Test Artist"
        self.file_path = player.get_local_path(self.title, self.artist)
        self.addCleanup(self._cleanup_files)

    def _cleanup_files(self):
        stem = self.file_path.with_suffix('').name
        for p in self.file_path.parent.glob(f"{stem}*"):
            try:
                p.unlink()
            except OSError:
                pass

    def _make_ydl(self, download_side_effect):
        ydl_cm = mock.MagicMock()
        ydl = ydl_cm.__enter__.return_value
        ydl.download.side_effect = download_side_effect
        return ydl_cm, ydl

    def test_403_then_success_retries_once(self):
        ydl_cm, ydl = self._make_ydl([_forbidden(), None])
        with mock.patch.object(player.yt_dlp, "YoutubeDL", return_value=ydl_cm):
            result = player.download_if_needed("vidid12345", self.title, self.artist)
        self.assertEqual(result, self.file_path)
        self.assertEqual(ydl.download.call_count, 2)

    def test_403_twice_raises(self):
        ydl_cm, ydl = self._make_ydl([_forbidden(), _forbidden()])
        with mock.patch.object(player.yt_dlp, "YoutubeDL", return_value=ydl_cm):
            with self.assertRaises(DownloadError):
                player.download_if_needed("vidid12345", self.title, self.artist)
        self.assertEqual(ydl.download.call_count, 2)

    def test_403_cleans_part_files_before_retry(self):
        base = self.file_path.with_suffix('')
        partial = Path(f"{base}.m4a.part")
        partial.write_bytes(b"partial-data")
        ydl_cm, ydl = self._make_ydl([_forbidden(), None])
        with mock.patch.object(player.yt_dlp, "YoutubeDL", return_value=ydl_cm):
            player.download_if_needed("vidid12345", self.title, self.artist)
        self.assertFalse(partial.exists())

    def test_already_downloaded_skips_ydl_entirely(self):
        self.file_path.write_bytes(b"already-here")
        with mock.patch.object(player.yt_dlp, "YoutubeDL") as ydl_cls:
            result = player.download_if_needed("vidid12345", self.title, self.artist)
        ydl_cls.assert_not_called()
        self.assertEqual(result, self.file_path)


class JsRuntimeOptsTest(unittest.TestCase):
    def test_enables_node_when_on_path(self):
        with mock.patch.object(player.shutil, "which", return_value="/usr/local/bin/node"):
            self.assertEqual(player._js_runtime_opts(), {"js_runtimes": {"node": {}}})

    def test_empty_when_node_missing(self):
        with mock.patch.object(player.shutil, "which", return_value=None):
            self.assertEqual(player._js_runtime_opts(), {})


if __name__ == "__main__":
    unittest.main()
