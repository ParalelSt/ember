"""loudness.py: the gain math, parsing ffmpeg's ebur128 summary, and a real
measurement of generated tones (Ember's own ffmpeg, no network).

    .venv/bin/python -m unittest tests/test_loudness.py
"""
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import loudness  # noqa: E402
from ffmpeg_path import ffmpeg_exe  # noqa: E402

SUMMARY = """
[Parsed_ebur128_0 @ 0x1] Summary:

  Integrated loudness:
    I:          -8.3 LUFS
    Threshold: -18.4 LUFS

  Loudness range:
    LRA:         4.1 LU

  True peak:
    Peak:        0.6 dBFS
"""


class ComputeGainTest(unittest.TestCase):
    def test_loud_master_is_turned_down_to_target(self):
        self.assertEqual(loudness.compute_gain(-8.0, 0.5), -6.0)

    def test_quiet_song_is_boosted_to_target_when_peak_allows(self):
        self.assertEqual(loudness.compute_gain(-18.0, -8.0), 4.0)

    def test_boost_is_held_under_the_true_peak_ceiling(self):
        # Wants +4, but the peak at -3 dBTP only has 2 dB left before -1.
        self.assertEqual(loudness.compute_gain(-18.0, -3.0), 2.0)

    def test_hot_peak_never_turns_a_quiet_song_down(self):
        self.assertEqual(loudness.compute_gain(-18.0, 0.3), 0.0)

    def test_cut_is_not_limited_by_peak(self):
        self.assertEqual(loudness.compute_gain(-5.0, 1.2), -9.0)

    def test_clamped_to_range(self):
        self.assertEqual(loudness.compute_gain(10.0, 2.0), loudness.MIN_GAIN_DB)
        self.assertEqual(loudness.compute_gain(-40.0, -30.0), loudness.MAX_GAIN_DB)

    def test_silence_and_garbage_get_zero(self):
        self.assertEqual(loudness.compute_gain(-70.0, -math.inf), 0.0)
        self.assertEqual(loudness.compute_gain(-math.inf, -math.inf), 0.0)
        self.assertEqual(loudness.compute_gain(math.nan, 0.0), 0.0)

    def test_unknown_peak_still_boosts(self):
        self.assertEqual(loudness.compute_gain(-16.0, math.nan), 2.0)

    def test_on_target_is_zero(self):
        self.assertEqual(loudness.compute_gain(-14.0, -1.0), 0.0)


class ParseTest(unittest.TestCase):
    def test_reads_integrated_and_true_peak(self):
        self.assertEqual(loudness.parse_ebur128(SUMMARY), (-8.3, 0.6))

    def test_last_summary_wins(self):
        early = SUMMARY.replace("-8.3", "-30.0").replace("0.6 dBFS", "-20.0 dBFS")
        self.assertEqual(loudness.parse_ebur128(early + SUMMARY), (-8.3, 0.6))

    def test_minus_inf(self):
        text = SUMMARY.replace("-8.3 LUFS", "-inf LUFS").replace("0.6 dBFS", "-inf dBFS")
        lufs, peak = loudness.parse_ebur128(text)
        self.assertEqual(lufs, -math.inf)
        self.assertEqual(peak, -math.inf)

    def test_no_summary_raises(self):
        with self.assertRaises(ValueError):
            loudness.parse_ebur128("Invalid data found when processing input")


FFMPEG = ffmpeg_exe()


def _tone(path: Path, volume_db: float, seconds: int = 8):
    """A stereo sine as AAC, like a YouTube m4a, at a chosen level."""
    subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi",
         "-i", f"sine=frequency=440:duration={seconds}:sample_rate=44100",
         "-af", f"volume={volume_db}dB", "-ac", "2", "-c:a", "aac", "-b:a", "128k", str(path)],
        check=True,
    )


@unittest.skipUnless(FFMPEG, "no ffmpeg on this host")
class AnalyzeTest(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="ember-loudness-test-"))
        self.addCleanup(shutil.rmtree, self.dir, True)

    def test_loud_and_quiet_tones_end_up_near_the_same_level(self):
        loud, quiet = "loudtone000", "quiettone00"
        _tone(self.dir / f"{loud}.m4a", 15)   # sine peaks near -3 dBFS
        _tone(self.dir / f"{quiet}.m4a", 0)   # 15 dB quieter
        a = loudness.analyze(loud, self.dir)
        b = loudness.analyze(quiet, self.dir)
        # The two measurements are 15 dB apart, as generated.
        self.assertAlmostEqual(a["lufs"] - b["lufs"], 15, delta=0.5)
        # After gain, both sit near the target (the quiet one is held back by
        # its peak ceiling only if it would clip: this one has headroom).
        self.assertAlmostEqual(a["lufs"] + a["gainDb"], loudness.TARGET_LUFS, delta=0.1)
        self.assertLess(a["gainDb"], 0)
        self.assertGreater(b["gainDb"], 0)
        self.assertLessEqual(b["peakDb"] + b["gainDb"], loudness.PEAK_CEILING_DB + 0.01)

    def test_writes_sidecar_and_reuses_it(self):
        vid = "sidecartone"
        _tone(self.dir / f"{vid}.m4a", 10)
        first = loudness.analyze(vid, self.dir)
        side = self.dir / f"{vid}.loudness.json"
        self.assertEqual(json.loads(side.read_text()), first)
        self.assertEqual(first["targetLufs"], loudness.TARGET_LUFS)
        with mock.patch.object(loudness, "measure") as m:
            self.assertEqual(loudness.analyze(vid, self.dir), first)
            m.assert_not_called()

    def test_corrupt_sidecar_is_measured_again(self):
        vid = "corrupttone"
        _tone(self.dir / f"{vid}.m4a", 10)
        (self.dir / f"{vid}.loudness.json").write_text("{not json")
        result = loudness.analyze(vid, self.dir)
        self.assertIn("gainDb", json.loads((self.dir / f"{vid}.loudness.json").read_text()))
        self.assertIsInstance(result["gainDb"], float)

    def test_not_downloaded_raises_and_writes_nothing(self):
        with self.assertRaises(FileNotFoundError):
            loudness.analyze("missingtone", self.dir)
        self.assertEqual(list(self.dir.iterdir()), [])

    def test_bad_id_is_refused(self):
        with self.assertRaises(ValueError):
            loudness.analyze("../../etc/x", self.dir)

    def test_undecodable_file_fails_cleanly(self):
        vid = "garbagefile"
        (self.dir / f"{vid}.m4a").write_text("FAKE-AUDIO")
        with self.assertRaises(RuntimeError):
            loudness.analyze(vid, self.dir)
        self.assertFalse((self.dir / f"{vid}.loudness.json").exists())

    def test_cli_prints_json_and_exits_zero(self):
        vid = "clitonecli0"
        _tone(self.dir / f"{vid}.m4a", 5)
        env = {**os.environ, "MUSIC_DIR": str(self.dir)}
        out = subprocess.run([sys.executable, str(ROOT / "loudness.py"), "--", vid],
                             capture_output=True, text=True, env=env, check=True)
        self.assertIn("gainDb", json.loads(out.stdout))

    def test_cli_reports_a_readable_error(self):
        env = {**os.environ, "MUSIC_DIR": str(self.dir)}
        out = subprocess.run([sys.executable, str(ROOT / "loudness.py"), "missingtone"],
                             capture_output=True, text=True, env=env)
        self.assertEqual(out.returncode, 1)
        self.assertIn("ERROR: loudness:", out.stderr)
        self.assertEqual(out.stdout, "")


class PlayerCommandTest(unittest.TestCase):
    """`player.py loudness <id>` is how the web server runs it."""

    def test_player_dispatches_to_loudness_main(self):
        with mock.patch.dict(os.environ, {"MUSIC_DIR": tempfile.mkdtemp(prefix="ember-loudness-player-")}):
            with mock.patch("ytmusicapi.YTMusic"):
                import player
        with mock.patch.object(player.loudness, "main", return_value=0) as m, \
                mock.patch.object(sys, "argv", ["player.py", "loudness", "--", "abcdefghijk"]):
            with self.assertRaises(SystemExit) as done:
                player.main()
        self.assertEqual(done.exception.code, 0)
        m.assert_called_once_with(["abcdefghijk"])


if __name__ == "__main__":
    unittest.main()
