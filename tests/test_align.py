"""align.py against recordings made up in the test (docs/tabs-v3.md section 3).

    .venv/bin/python -m unittest tests/test_align.py      # or: npm run test:align

A riff is written as a tab plan (what apps/web/lib/tabPlan.ts hands
align.py) and played as audio: a plucked tone per note and a click on
every beat, at the recording's own tempo and start. Then align.py has to
find where bar 1 starts, where every other bar starts, and how sure it is:

  - 97.4 bpm (a tempo that is no whole number), bar 1 at 0.35 s;
  - a band speeding up from 100 to 108 bpm over the song, the tab at a
    steady 100;
  - the wrong tab (another riff, rhythm and key) for the first recording,
    which must score low.

numpy, scipy, soundfile and librosa from the venv; no network, no files
beyond a temp dir.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import align  # noqa: E402

SR = 22050
LINED_UP = 0.5   # lib/tabSync.ts LINED_UP_CONFIDENCE


def midi_hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


# A two-bar riff in E, beats in quarter notes: (beat, pitches, length).
RIFF = [
    [(0, [40, 47], 0.5), (0.5, [40], 0.5), (1.5, [43], 0.5), (2, [45, 52], 1), (3, [43], 0.5), (3.5, [40], 0.5)],
    [(0, [40, 47], 1), (1, [50], 0.5), (1.75, [52], 0.25), (2.5, [47], 0.5), (3, [45], 0.5), (3.5, [43], 0.5)],
]
# Another song: straight sixteenth pick-ups around the beat, in F#.
WRONG = [
    [(0.25, [42], 0.25), (0.75, [49], 0.25), (1.25, [46], 0.25), (2.25, [54], 0.5), (2.75, [49], 0.25), (3.75, [42], 0.25)],
    [(0.25, [44], 0.5), (1.25, [51], 0.25), (1.75, [49], 0.25), (2.25, [44], 0.25), (3.25, [54], 0.5)],
]


def plan_for(riff, bars: int, bpm: float) -> dict:
    """A tab plan: `bars` bars of 4/4 at `bpm`, the riff over and over."""
    q = 60.0 / bpm
    out_bars, notes = [], []
    for b in range(bars):
        start = b * 4 * q
        out_bars.append({"bar": b, "ms": round(start * 1000, 1), "sig": [4, 4]})
        for beat, pitches, length in riff[b % len(riff)]:
            notes.append({"ms": round((start + beat * q) * 1000, 1), "dur": round(length * q * 1000, 1), "p": pitches})
    return {"version": 1, "tempo": bpm, "bars": out_bars, "notes": notes, "endMs": round(bars * 4 * q * 1000, 1)}


def pluck(buf: np.ndarray, at: float, pitch: float, length: float, gain: float = 0.25) -> None:
    i = int(at * SR)
    n = int(min(length + 0.3, 1.5) * SR)
    if i >= len(buf):
        return
    n = min(n, len(buf) - i)
    t = np.arange(n) / SR
    f = midi_hz(pitch)
    tone = sum(np.sin(2 * np.pi * f * h * t) / h for h in (1, 2, 3, 4))
    env = np.exp(-t / 0.35) * np.minimum(1.0, t / 0.003)
    buf[i:i + n] += gain * tone * env


def click(buf: np.ndarray, at: float, gain: float = 0.5) -> None:
    i = int(at * SR)
    n = min(int(0.02 * SR), len(buf) - i)
    if n <= 0:
        return
    t = np.arange(n) / SR
    rng = np.random.default_rng(i)
    buf[i:i + n] += gain * rng.standard_normal(n) * np.exp(-t / 0.004)


def render(plan: dict, song_time, length_s: float) -> np.ndarray:
    """The plan played: every note at song_time(tab seconds), and a click on
    every beat of the tab."""
    buf = np.zeros(int(length_s * SR))
    q = 60.0 / plan["tempo"]
    end = plan["endMs"] / 1000
    for n in plan["notes"]:
        t = n["ms"] / 1000
        s = song_time(t)
        dur = song_time(t + n["dur"] / 1000) - s
        for p in n["p"]:
            pluck(buf, s, p, dur)
    beat = 0.0
    while beat < end:
        click(buf, song_time(beat))
        beat += q
    rng = np.random.default_rng(7)
    buf += 0.003 * rng.standard_normal(len(buf))
    return (buf / max(1e-9, np.max(np.abs(buf))) * 0.8).astype(np.float32)


def steady(offset: float, tab_bpm: float, rec_bpm: float):
    k = tab_bpm / rec_bpm
    return lambda t: offset + t * k


def drifting(offset: float, tab_bpm: float, from_bpm: float, to_bpm: float, beats: int):
    """Beat n of the tab (steady at tab_bpm) sounds where a band speeding up
    linearly from `from_bpm` to `to_bpm` over `beats` beats plays it."""
    q = 60.0 / tab_bpm
    bpms = np.linspace(from_bpm, to_bpm, beats + 1)
    song = np.concatenate([[0.0], np.cumsum(60.0 / bpms)]) + offset
    tab = np.arange(beats + 2) * q
    return lambda t: float(np.interp(t, tab, song, right=song[-1] + (t - tab[-1]) * 60.0 / to_bpm))


class AlignSynthetic(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # 97.4 bpm, bar 1 at 0.35 s, the tab written at the same tempo.
        cls.plan = plan_for(RIFF, 40, 97.4)
        cls.truth = staticmethod(steady(0.35, 97.4, 97.4))
        cls.audio = render(cls.plan, cls.truth, 105)
        cls.result = align.align(cls.audio, cls.plan)

    def test_offset_within_30_ms(self):
        r = self.result
        self.assertLessEqual(abs(r["offset_ms"] - 350), 30, json.dumps(r["scores"]))

    def test_every_bar_within_50_ms(self):
        errs = [abs(b["ms"] / 1000 - self.truth(self.plan["bars"][b["bar"]]["ms"] / 1000)) for b in self.result["bars"]]
        self.assertEqual(len(errs), 40)
        self.assertLessEqual(max(errs), 0.05, f"worst {max(errs):.3f}s")

    def test_lined_up_and_tempo(self):
        self.assertGreaterEqual(self.result["confidence"], LINED_UP, json.dumps(self.result["scores"]))
        self.assertAlmostEqual(self.result["bpm"], 97.4, delta=0.5)

    def test_a_tab_written_slower_than_the_recording(self):
        # The same riff tabbed at 92 bpm: the recording is 97.4, from 1.8 s.
        plan = plan_for(RIFF, 40, 92.0)
        truth = steady(1.8, 92.0, 97.4)
        r = align.align(render(plan, truth, 105), plan)
        self.assertLessEqual(abs(r["offset_ms"] - 1800), 30, json.dumps(r["scores"]))
        errs = [abs(b["ms"] / 1000 - truth(plan["bars"][b["bar"]]["ms"] / 1000)) for b in r["bars"]]
        self.assertLessEqual(max(errs), 0.05, f"worst {max(errs):.3f}s")
        self.assertAlmostEqual(r["bpm"], 97.4, delta=0.5)

    def test_the_wrong_tab_scores_low(self):
        wrong = plan_for(WRONG, 40, 88.0)
        r = align.align(self.audio, wrong)
        self.assertLess(r["confidence"], LINED_UP, json.dumps(r["scores"]))
        self.assertLess(r["confidence"], self.result["confidence"] - 0.3)

    def test_silence_is_not_lined_up(self):
        r = align.align(np.zeros(SR * 20, dtype=np.float32), self.plan)
        self.assertEqual(r["confidence"], 0.0)
        self.assertEqual(r["bars"], [])


class AlignDrift(unittest.TestCase):
    def test_a_band_speeding_up_from_100_to_108(self):
        bars = 48
        plan = plan_for(RIFF, bars, 100.0)
        truth = drifting(0.35, 100.0, 100.0, 108.0, bars * 4)
        audio = render(plan, truth, truth(bars * 2.4) + 3)
        r = align.align(audio, plan)
        self.assertLessEqual(abs(r["offset_ms"] - 350), 30, json.dumps(r["scores"]))
        errs = [abs(b["ms"] / 1000 - truth(plan["bars"][b["bar"]]["ms"] / 1000)) for b in r["bars"]]
        self.assertEqual(len(errs), bars)
        self.assertLessEqual(max(errs), 0.05, f"worst {max(errs):.3f}s at bar {int(np.argmax(errs))}")
        self.assertGreaterEqual(r["confidence"], LINED_UP, json.dumps(r["scores"]))
        # The anchors are what keeps it: one steady tempo from bar 1 at the
        # song's average would be far out in the middle of the song.
        steady_errs = [abs(r["offset_ms"] / 1000 + b["ms"] / 1000 * 100 / r["bpm"] - truth(b["ms"] / 1000)) for b in plan["bars"]]
        self.assertGreater(max(steady_errs), 0.3)


class AlignCli(unittest.TestCase):
    def test_the_command_writes_timing_json(self):
        import soundfile as sf
        plan = plan_for(RIFF, 16, 110.0)
        audio = render(plan, steady(0.5, 110.0, 110.0), 40)
        with tempfile.TemporaryDirectory() as tmp:
            wav, pj, out = (os.path.join(tmp, n) for n in ("a.wav", "plan.json", "sub/out.json"))
            sf.write(wav, audio, SR)
            with open(pj, "w") as f:
                json.dump(plan, f)
            r = subprocess.run([sys.executable, os.path.join(ROOT, "align.py"), wav, pj, out], capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
            line = json.loads(r.stdout.strip().splitlines()[-1])
            with open(out) as f:
                timing = json.load(f)
            self.assertEqual(set(timing) >= {"offset_ms", "bpm", "confidence", "bars"}, True)
            self.assertEqual(line["bars"], 16)
            self.assertLessEqual(abs(timing["offset_ms"] - 500), 30)

    def test_a_missing_file_is_one_line(self):
        r = subprocess.run([sys.executable, os.path.join(ROOT, "align.py"), "/nope.wav", "/nope.json", "/tmp/x.json"], capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertEqual(r.stderr.strip(), "no such audio file: /nope.wav")


if __name__ == "__main__":
    unittest.main()
