"""player.py and YTDLP_COOKIE_FILE: yt-dlp saves its cookie jar back to the
cookie file when a run ends, by truncating the file and writing it again.
Several player.py runs share the file at once, so one that loaded it in the
middle of another's save read it empty, and saved that empty jar back: the
owner's YouTube session gone for good. Each run now hands yt-dlp its own copy.

    .venv/bin/python -m unittest tests/test_player_cookies.py
"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent

os.environ.setdefault("MUSIC_DIR", tempfile.mkdtemp(prefix="ember-cookies-test-"))
sys.path.insert(0, str(ROOT))
with mock.patch("ytmusicapi.YTMusic"):
    import player  # noqa: E402

COOKIES = "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsecret\n"


class CookieCopyTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="ember-cookies-"))
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.original = self.dir / "cookies.txt"
        self.original.write_text(COOKIES)
        self.copies = self.dir / "copies"
        patches = [
            mock.patch.dict(os.environ, {"YTDLP_COOKIE_FILE": str(self.original)}),
            mock.patch.object(player, "COOKIE_COPY_DIR", self.copies, create=True),
            mock.patch.object(player, "_cookie_copy_path", None, create=True),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def test_yt_dlp_gets_a_private_copy_and_the_original_is_never_written(self):
        opts = player._cookie_opts()
        copy = Path(opts["cookiefile"])
        self.assertNotEqual(copy.resolve(), self.original.resolve())
        self.assertEqual(copy.read_text(), COOKIES)
        # What yt-dlp's save does at the end of a run: truncate, then write.
        with open(copy, "w") as f:
            f.write("")
        self.assertEqual(self.original.read_text(), COOKIES)
        # One copy per run: every option set in this process shares it.
        self.assertEqual(player._cookie_opts(), opts)

    def test_the_copy_is_private(self):
        copy = Path(player._cookie_opts()["cookiefile"])
        self.assertEqual(copy.stat().st_mode & 0o077, 0)

    def test_the_copy_is_removed_when_the_run_ends(self):
        script = (
            "import os, sys; from unittest import mock\n"
            f"sys.path.insert(0, {str(ROOT)!r})\n"
            "with mock.patch('ytmusicapi.YTMusic'):\n"
            "    import player\n"
            f"player.COOKIE_COPY_DIR = player.Path({str(self.copies)!r})\n"
            "print(player._cookie_opts()['cookiefile'])\n"
        )
        env = {**os.environ, "YTDLP_COOKIE_FILE": str(self.original)}
        out = subprocess.run([sys.executable, "-c", script], capture_output=True, text=True, env=env, check=True)
        copy = Path(out.stdout.strip())
        self.assertTrue(str(copy).startswith(str(self.copies)))
        self.assertFalse(copy.exists())

    def test_a_killed_runs_copy_is_swept_by_the_next_run(self):
        # SIGKILL (the web server's timeout) skips any cleanup of the run's own.
        self.copies.mkdir(mode=0o700)
        dead = subprocess.Popen([sys.executable, "-c", "pass"])
        dead.wait()
        stale = self.copies / f"{dead.pid}-abc.txt"
        stale.write_text(COOKIES)
        mine = self.copies / f"{os.getppid()}-live.txt"
        mine.write_text(COOKIES)
        player._cookie_opts()
        self.assertFalse(stale.exists())
        self.assertTrue(mine.exists())

    def test_no_cookie_file_means_no_cookie_options(self):
        with mock.patch.dict(os.environ, {"YTDLP_COOKIE_FILE": ""}):
            self.assertEqual(player._cookie_opts(), {})
        self.assertFalse(self.copies.exists())


if __name__ == "__main__":
    unittest.main()
