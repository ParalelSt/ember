"""Ember finds its own ffmpeg (ffmpeg_path.py) with nothing on PATH.

    .venv/bin/python -m unittest tests/test_ffmpeg_path.py     # or: npm run test:ffmpeg

Needs the venv's imageio-ffmpeg for the bundled-binary checks (they are
skipped without it). No network, no audio beyond one generated second.
"""
from __future__ import annotations

import importlib
import os
import subprocess
import sys
import tempfile
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import ffmpeg_path  # noqa: E402

try:
    import imageio_ffmpeg  # type: ignore  # noqa: F401
    HAS_BUNDLED = True
except ImportError:
    HAS_BUNDLED = False


def run_py(code: str, path: str = "") -> subprocess.CompletedProcess:
    """Run Python code from the repo root with PATH set to `path` only."""
    return subprocess.run([sys.executable, "-c", code], cwd=ROOT, env={"PATH": path},
                          capture_output=True, text=True, timeout=60)


class ResolverTest(unittest.TestCase):
    @unittest.skipUnless(HAS_BUNDLED, "imageio-ffmpeg is not installed in this Python")
    def test_bundled_binary_found_with_empty_path(self):
        r = run_py("import ffmpeg_path; print(ffmpeg_path.ffmpeg_exe())")
        self.assertEqual(r.returncode, 0, r.stderr)
        exe = r.stdout.strip()
        self.assertIn("imageio_ffmpeg", exe)
        self.assertTrue(os.access(exe, os.X_OK))
        version = subprocess.run([exe, "-version"], capture_output=True, text=True, timeout=30)
        self.assertEqual(version.returncode, 0)
        self.assertIn("ffmpeg version", version.stdout)

    @unittest.skipUnless(HAS_BUNDLED, "imageio-ffmpeg is not installed in this Python")
    def test_script_prints_the_path(self):
        r = subprocess.run([sys.executable, os.path.join(ROOT, "ffmpeg_path.py")], env={"PATH": ""},
                           capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("imageio_ffmpeg", r.stdout)

    def test_falls_back_to_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            fake = os.path.join(tmp, "ffmpeg")
            with open(fake, "w") as f:
                f.write("#!/bin/sh\necho fake\n")
            os.chmod(fake, 0o755)
            with mock.patch.object(ffmpeg_path, "bundled_ffmpeg", return_value=None), \
                    mock.patch.dict(os.environ, {"PATH": tmp}):
                self.assertEqual(ffmpeg_path.ffmpeg_exe(), fake)

    def test_none_when_nothing_anywhere(self):
        with mock.patch.object(ffmpeg_path, "bundled_ffmpeg", return_value=None), \
                mock.patch.dict(os.environ, {"PATH": ""}):
            self.assertIsNone(ffmpeg_path.ffmpeg_exe())

    def test_bundled_none_when_package_missing(self):
        with mock.patch.dict(sys.modules, {"imageio_ffmpeg": None}):
            self.assertIsNone(ffmpeg_path.bundled_ffmpeg())

    def test_script_says_run_update_when_missing(self):
        # No imageio_ffmpeg importable and nothing on PATH.
        code = ("import sys; sys.modules['imageio_ffmpeg'] = None; import runpy; "
                "runpy.run_path('ffmpeg_path.py', run_name='__main__')")
        r = run_py(code)
        self.assertEqual(r.returncode, 1)
        self.assertIn("ffmpeg is missing: run ./update.sh", r.stderr)


class TranscribeDecodeTest(unittest.TestCase):
    def test_decode_message_when_missing(self):
        transcribe = importlib.import_module("transcribe")
        with mock.patch.object(transcribe, "ffmpeg_exe", return_value=None), \
                mock.patch("sys.stderr") as err:
            with self.assertRaises(SystemExit) as cm:
                transcribe.decode("in.m4a", "out.wav")
        self.assertEqual(cm.exception.code, 1)
        written = "".join(c.args[0] for c in err.write.call_args_list)
        self.assertIn("ffmpeg is missing: run ./update.sh", written)

    @unittest.skipUnless(HAS_BUNDLED, "imageio-ffmpeg is not installed in this Python")
    def test_decode_works_with_empty_path(self):
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "tone.wav")
            dst = os.path.join(tmp, "mix.wav")
            _write_wav(src)
            code = f"import transcribe; transcribe.decode({src!r}, {dst!r})"
            r = run_py(code)
            self.assertEqual(r.returncode, 0, r.stderr)
            self.assertGreater(os.path.getsize(dst), 44)


class PlayerOptsTest(unittest.TestCase):
    def test_player_passes_ffmpeg_location(self):
        # player.py builds YTMusic at import; check the source wiring instead of
        # importing it (that would need ytmusicapi and yt_dlp).
        with open(os.path.join(ROOT, "player.py"), encoding="utf-8") as f:
            src = f.read()
        self.assertIn("from ffmpeg_path import ffmpeg_exe", src)
        self.assertIn('{"ffmpeg_location": exe}', src)
        # Every yt-dlp option set that takes cookies takes the ffmpeg too.
        self.assertEqual(src.count("**_cookie_opts(),"), src.count("**_ffmpeg_opts(),"))


def _write_wav(path: str, seconds: float = 1.0, rate: int = 8000) -> None:
    import math
    import struct
    import wave
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        frames = b"".join(struct.pack("<h", int(3000 * math.sin(2 * math.pi * 440 * i / rate)))
                          for i in range(int(seconds * rate)))
        w.writeframes(frames)


if __name__ == "__main__":
    unittest.main()
