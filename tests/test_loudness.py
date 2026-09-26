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
    # The same cases as apps/web/lib/loudnessPolicy.test.ts: the server
    # recomputes stored gains in TypeScript and must agree with this.
    def test_target_is_where_a_typical_song_already_sits(self):
        self.assertEqual(loudness.TARGET_LUFS, -9.0)
        self.assertEqual(loudness.compute_gain(-9.0, 1.0), 0.0)

    def test_loud_master_is_turned_down_to_target(self):
        self.assertEqual(loudness.compute_gain(-6.0, 2.0), -3.0)

    def test_cut_is_never_more_than_a_few_db(self):
        self.assertEqual(loudness.compute_gain(-2.0, 3.0), loudness.MIN_GAIN_DB)
        self.assertEqual(loudness.MIN_GAIN_DB, -5.0)

    def test_quiet_song_is_boosted_to_target_when_peak_allows(self):
        self.assertEqual(loudness.compute_gain(-13.0, -8.0), 4.0)

    def test_boost_is_held_under_the_true_peak_ceiling(self):
        # Wants +4, but the peak at -3 dBTP only has 2 dB left before -1.
        self.assertEqual(loudness.compute_gain(-13.0, -3.0), 2.0)

    def test_hot_peak_never_turns_a_quiet_song_down(self):
        self.assertEqual(loudness.compute_gain(-13.0, 0.3), 0.0)

    def test_cut_is_not_limited_by_peak(self):
        self.assertEqual(loudness.compute_gain(-5.0, 1.2), -4.0)

    def test_clamped_to_range(self):
        self.assertEqual(loudness.compute_gain(10.0, 2.0), loudness.MIN_GAIN_DB)
        self.assertEqual(loudness.compute_gain(-40.0, -30.0), loudness.MAX_GAIN_DB)

    def test_silence_and_garbage_get_zero(self):
        self.assertEqual(loudness.compute_gain(-70.0, -math.inf), 0.0)
        self.assertEqual(loudness.compute_gain(-math.inf, -math.inf), 0.0)
        self.assertEqual(loudness.compute_gain(math.nan, 0.0), 0.0)
        self.assertEqual(loudness.compute_gain(None, None), 0.0)

    def test_unknown_peak_is_never_boosted(self):
        # No limiter anywhere in the players: a boost must be known not to clip.
        self.assertEqual(loudness.compute_gain(-16.0, math.nan), 0.0)
        self.assertEqual(loudness.compute_gain(-16.0, None), 0.0)
        # A cut needs no peak.
        self.assertEqual(loudness.compute_gain(-7.0, None), -2.0)

    def test_never_negative_zero(self):
        self.assertEqual(str(loudness.compute_gain(-9.001, 5.0)), "0.0")

    def test_measured_sample_keeps_the_library_level(self):
        """39 real songs from the owner's library (measured 2026-09-26):
        integrated loudness and true peak. Under the old -14 LUFS policy 35
        of them were turned down, by 4.8 dB at the median. Now a typical
        song is untouched and the average is within half a dB."""
        sample = [
            (-12.1, 1.0), (-7.6, 1.7), (-17.5, -6.6), (-21.1, -1.4), (-13.2, 0.4), (-9.8, 0.7),
            (-7.9, 1.7), (-8.0, 1.2), (-9.9, 0.7), (-21.7, -7.8), (-8.9, 1.0), (-9.6, 1.0),
            (-6.9, 2.0), (-9.6, 1.4), (-5.7, 3.4), (-10.3, 2.6), (-9.5, 0.7), (-8.8, 1.6),
            (-5.8, 2.5), (-13.8, -1.6), (-8.0, 2.6), (-10.7, 1.3), (-8.6, 1.0), (-7.9, 1.1),
            (-13.1, -0.4), (-7.5, 0.9), (-6.2, 1.6), (-13.6, 0.4), (-20.0, -0.9), (-10.6, -0.2),
            (-7.9, 3.1), (-11.8, -1.2), (-6.6, 2.1), (-9.2, 1.4), (-7.7, 1.7), (-6.2, 1.8),
            (-7.6, 2.2), (-12.8, -3.5), (-6.3, 2.5),
        ]
        gains = sorted(loudness.compute_gain(l, p) for l, p in sample)
        self.assertEqual(gains[len(gains) // 2], 0.0)
        self.assertGreater(sum(gains) / len(gains), -0.5)
        self.assertGreaterEqual(gains[0], -3.5)


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

    def test_old_policy_sidecar_answers_with_the_current_gain(self):
        vid = "oldpolicy00"
        (self.dir / f"{vid}.m4a").write_text("AUDIO")
        (self.dir / f"{vid}.loudness.json").write_text(json.dumps(
            {"lufs": -8.0, "peakDb": 1.2, "gainDb": -6.0, "targetLufs": -14.0}))
        with mock.patch.object(loudness, "measure") as m:
            result = loudness.analyze(vid, self.dir)
            m.assert_not_called()
        self.assertEqual(result["gainDb"], -1.0)
        self.assertEqual(result["targetLufs"], loudness.TARGET_LUFS)
        self.assertEqual(result["lufs"], -8.0)

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
