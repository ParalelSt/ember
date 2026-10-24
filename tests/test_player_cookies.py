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


ROTATED = "# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsecret\n" \
    "#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\t__Secure-1PSIDTS\trotated\n"


class CookieSaveBackTest(unittest.TestCase):
    """yt-dlp keeps the session alive by rotating cookies and saving them to
    the file it was given: the private copy. A run that ends well hands that
    back to the original, atomically, under a lock, and only a real jar."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="ember-cookies-"))
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.original = self.dir / "cookies.txt"
        self.original.write_text(COOKIES)
        os.chmod(self.original, 0o600)
        self.copies = self.dir / "copies"
        patches = [
            mock.patch.dict(os.environ, {"YTDLP_COOKIE_FILE": str(self.original)}),
            mock.patch.object(player, "COOKIE_COPY_DIR", self.copies, create=True),
            mock.patch.object(player, "_cookie_copy_path", None, create=True),
            mock.patch.object(player, "_cookie_copy_source", None, create=True),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)

    def run_with(self, saved, exit_code=None):
        """player.run() around a command whose yt-dlp saved `saved` into the copy."""
        def command():
            copy = Path(player._cookie_opts()["cookiefile"])
            copy.write_text(saved)
            if exit_code is not None:
                sys.exit(exit_code)
        with mock.patch.object(player, "main", command):
            if exit_code is not None:
                with self.assertRaises(SystemExit):
                    player.run()
            else:
                player.run()

    def test_a_run_that_ends_well_saves_the_rotated_cookies_to_the_original(self):
        self.run_with(ROTATED)
        self.assertEqual(self.original.read_text(), ROTATED)
        self.assertEqual(self.original.stat().st_mode & 0o777, 0o600)
        # Atomic: written beside it and renamed, nothing left behind.
        self.assertEqual(sorted(p.name for p in self.dir.iterdir() if p.is_file()), ["cookies.txt"])

    def test_sys_exit_0_counts_as_ending_well(self):
        self.run_with(ROTATED, exit_code=0)
        self.assertEqual(self.original.read_text(), ROTATED)

    def test_a_failed_run_saves_nothing(self):
        self.run_with(ROTATED, exit_code=1)
        self.assertEqual(self.original.read_text(), COOKIES)

    def test_an_empty_or_unreadable_jar_never_replaces_the_original(self):
        for bad in ["", "# Netscape HTTP Cookie File\n", "not a cookie file\n", ".youtube.com\tTRUE\t/\tTRUE\t0\tSID\tx\n"]:
            with self.subTest(saved=bad):
                with mock.patch.object(player, "_cookie_copy_path", None), mock.patch.object(player, "_cookie_copy_source", None):
                    self.run_with(bad)
                self.assertEqual(self.original.read_text(), COOKIES)

    def test_an_unchanged_copy_leaves_the_original_alone(self):
        before = self.original.stat()
        self.run_with(COOKIES)
        after = self.original.stat()
        self.assertEqual((before.st_ino, before.st_mtime_ns), (after.st_ino, after.st_mtime_ns))

    def test_a_file_replaced_meanwhile_is_not_overwritten(self):
        # The owner exported a fresh file, or another run saved first.
        fresh = COOKIES.replace("secret", "fresh")

        def command():
            copy = Path(player._cookie_opts()["cookiefile"])
            self.original.write_text(fresh)
            copy.write_text(ROTATED)
        with mock.patch.object(player, "main", command):
            player.run()
        self.assertEqual(self.original.read_text(), fresh)

    def test_the_save_holds_the_lock(self):
        import fcntl
        held = []
        real = fcntl.flock

        def flock(f, op):
            held.append(op)
            return real(f, op)
        with mock.patch.object(fcntl, "flock", flock):
            self.run_with(ROTATED)
        self.assertIn(fcntl.LOCK_EX, held)
        self.assertEqual(self.original.read_text(), ROTATED)

    def test_two_runs_saving_at_once_leave_one_whole_jar(self):
        script = (
            "import os, sys; from pathlib import Path; from unittest import mock\n"
            f"sys.path.insert(0, {str(ROOT)!r})\n"
            "with mock.patch('ytmusicapi.YTMusic'):\n"
            "    import player\n"
            f"player.COOKIE_COPY_DIR = Path({str(self.copies)!r})\n"
            "def command():\n"
            "    copy = Path(player._cookie_opts()['cookiefile'])\n"
            "    copy.write_text(sys.argv[1])\n"
            "player.main = command\n"
            "player.run()\n"
        )
        env = {**os.environ, "YTDLP_COOKIE_FILE": str(self.original)}
        jars = [ROTATED.replace("rotated", f"run{i}" * 2000) for i in range(6)]
        runs = [subprocess.Popen([sys.executable, "-c", script, jar], env=env) for jar in jars]
        for r in runs:
            self.assertEqual(r.wait(), 0)
        self.assertIn(self.original.read_text(), jars)


if __name__ == "__main__":
    unittest.main()
