"""`transcribe.py --check`: can this host generate tabs? (the tab page asks
through /api/tabs/tools and greys out "Generate a tab" when it cannot).

    .venv/bin/python -m unittest tests/test_transcribe_check.py

No audio, no model: the check only looks modules up, never imports them.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from unittest import mock

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import transcribe  # noqa: E402


def finder(present: set[str]):
    return lambda name: object() if name in present else None


class MissingModules(unittest.TestCase):
    def test_everything_there(self):
        have = set(transcribe.REQUIRED_MODULES) | {"onnxruntime"}
        self.assertEqual(transcribe.missing_modules(finder(have)), [])

    def test_any_one_backend_will_do(self):
        have = set(transcribe.REQUIRED_MODULES) | {"tensorflow"}
        self.assertEqual(transcribe.missing_modules(finder(have)), [])

    def test_a_bare_host_lacks_basic_pitch_and_a_backend(self):
        missing = transcribe.missing_modules(finder(set()))
        self.assertEqual(missing[0], "basic_pitch")
        self.assertIn("onnxruntime", missing)
        self.assertIn("librosa", missing)

    def test_only_what_is_missing(self):
        have = (set(transcribe.REQUIRED_MODULES) - {"resampy"}) | {"onnxruntime"}
        self.assertEqual(transcribe.missing_modules(finder(have)), ["resampy"])

    def test_a_finder_that_throws_reads_as_missing(self):
        def broken(name):
            raise ValueError(name)
        self.assertIn("basic_pitch", transcribe.missing_modules(broken))


class CheckFlag(unittest.TestCase):
    def test_check_adds_ffmpeg_when_there_is_none(self):
        with mock.patch.object(transcribe, "missing_modules", return_value=[]), \
                mock.patch.object(transcribe, "ffmpeg_exe", return_value=None):
            self.assertEqual(transcribe.check(), {"ok": False, "missing": ["ffmpeg"]})
        with mock.patch.object(transcribe, "missing_modules", return_value=[]), \
                mock.patch.object(transcribe, "ffmpeg_exe", return_value="/usr/bin/ffmpeg"):
            self.assertEqual(transcribe.check(), {"ok": True, "missing": []})

    def test_the_command_prints_one_json_line_and_exits_0(self):
        r = subprocess.run([sys.executable, os.path.join(ROOT, "transcribe.py"), "--check"],
                           capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stderr)
        out = json.loads(r.stdout.strip().splitlines()[-1])
        self.assertIsInstance(out["ok"], bool)
        self.assertIsInstance(out["missing"], list)
        self.assertEqual(out["ok"], out["missing"] == [])


if __name__ == "__main__":
    unittest.main()
