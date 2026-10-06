"""How closely a lined-up tab follows the recording, in milliseconds.

    .venv/bin/python -m unittest tests/test_align_sync.py   # or: npm run test:align-sync
    SYNC_REPORT=1 ... prints every scenario's numbers

tests/test_align.py checks that align.py finds the start and the bars. This
one measures what the listener sees: a song is made up with KNOWN timing
from a tab (a plucked tone per note, a click on every beat, a silent intro,
a little human timing jitter), align.py runs on it as the server runs it,
and then every bar AND every beat of the tab is placed in the song the way
the tab page places them (lib/tabSync.ts tabMsToSongSecAligned: straight
lines between the bar anchors, the edge pace beyond them). The error of
each against the truth is reported as mean and max.

Thresholds, and why:

  - mean under 40 ms, max under 100 ms for a song that matches its tab. The
    eye forgives a picture about 40 ms late and notices it at about 100 ms
    (audio-visual sync research puts the window at roughly -45 to +100 ms),
    and 100 ms is under a sixteenth note up to 150 bpm, so the line never
    sits on the wrong note. The jitter alone (a player off the grid by up
    to 15 ms per note) costs up to 15 ms of that, because the truth is the
    grid, not the jittered notes.
  - a recording that does not match its tab (an extra intro bar, a chorus
    played twice where the tab has it once) is measured on the part that
    does match, and the confidence has to say what happened.

numpy, scipy, soundfile and librosa from the venv; no network, no files.
"""
from __future__ import annotations

import json
import os
import sys
import unittest

import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
sys.path.insert(0, os.path.join(ROOT, "tests"))

import align  # noqa: E402
from test_align import SR, click, pluck  # noqa: E402

LINED_UP = 0.5           # lib/tabSync.ts LINED_UP_CONFIDENCE
MEAN_MS = 40
MAX_MS = 100
INTRO_S = 3.2
REPORT = os.environ.get("SYNC_REPORT") == "1"

# Two sections with their own riffs (pitches and rhythm), so a chorus is not
# just the verse again: (beat, pitches, length in beats).
VERSE = [
    [(0, [40, 47], 0.5), (0.5, [40], 0.5), (1.5, [43], 0.5), (2, [45, 52], 1), (3, [43], 0.5), (3.5, [40], 0.5)],
    [(0, [40, 47], 1), (1, [50], 0.5), (1.75, [52], 0.25), (2.5, [47], 0.5), (3, [45], 0.5), (3.5, [43], 0.5)],
]
CHORUS = [
    [(0, [45, 52, 57], 1), (1, [45], 0.5), (1.5, [48], 0.5), (2, [43, 50, 55], 1.5), (3.5, [47], 0.5)],
    [(0, [41, 48, 53], 1), (1, [53], 0.5), (2, [43, 50, 55], 0.75), (2.75, [55], 0.25), (3, [50], 1)],
]
BRIDGE = [  # an intro the tab does not have: a different chord, all quarters
    [(0, [38, 45, 50], 1), (1, [38, 45, 50], 1), (2, [38, 45, 50], 1), (3, [38, 45, 50], 1)],
]


def sections(*names: tuple[str, int]) -> list:
    """Bars of riff, section by section: ("verse", 8), ("chorus", 8)..."""
    riffs = {"verse": VERSE, "chorus": CHORUS, "bridge": BRIDGE}
    out = []
    for name, count in names:
        riff = riffs[name]
        out += [riff[i % len(riff)] for i in range(count)]
    return out


def plan_of(bars: list, bpms: list[float]) -> dict:
    """A tab plan (what lib/tabPlan.ts hands align.py): one riff bar per
    bar, bar i at bpms[i] quarter notes per minute (a tempo change in the
    tab is a change in this list)."""
    out_bars, notes, beats = [], [], []
    start = 0.0
    for b, riff in enumerate(bars):
        q = 60.0 / bpms[b]
        out_bars.append({"bar": b, "ms": round(start * 1000, 1), "sig": [4, 4]})
        for k in range(4):
            beats.append(start + k * q)
        for beat, pitches, length in riff:
            notes.append({"ms": round((start + beat * q) * 1000, 1), "dur": round(length * q * 1000, 1), "p": pitches})
        start += 4 * q
    return {"version": 1, "tempo": bpms[0], "bars": out_bars, "notes": notes, "endMs": round(start * 1000, 1), "_beats": beats}


def render(events: list[tuple[float, float, list[int]]], beats: list[float], length_s: float, jitter_s: float, seed: int = 3) -> np.ndarray:
    """Notes (song time, length, pitches) plucked, each off the grid by up
    to `jitter_s` either way, and a click on every beat (also jittered)."""
    rng = np.random.default_rng(seed)
    buf = np.zeros(int(length_s * SR))
    for t, dur, pitches in events:
        j = float(rng.uniform(-jitter_s, jitter_s))
        for p in pitches:
            pluck(buf, t + j, p, dur)
    for t in beats:
        click(buf, t + float(rng.uniform(-jitter_s, jitter_s)))
    buf += 0.003 * np.random.default_rng(7).standard_normal(len(buf))
    return (buf / max(1e-9, np.max(np.abs(buf))) * 0.8).astype(np.float32)


def performance(bars: list, bpms: list[float], start_s: float) -> tuple[list, list, list[float]]:
    """The band playing `bars` at `bpms` from `start_s`: (note events, beat
    times, bar start times), all in song seconds."""
    events, beats, starts = [], [], []
    t = start_s
    for b, riff in enumerate(bars):
        q = 60.0 / bpms[b]
        starts.append(t)
        beats += [t + k * q for k in range(4)]
        for beat, pitches, length in riff:
            events.append((t + beat * q, length * q, pitches))
        t += 4 * q
    return events, beats, starts


def tab_to_song(result: dict, plan: dict, tab_s: np.ndarray) -> np.ndarray:
    """Where the tab page puts tab time `tab_s` (s) in the song, through the
    alignment's bar anchors: lib/tabSync.ts syncPoints and piecewise, with
    the edge slope clamped to 0.5..2 as there."""
    by_bar = {b["bar"]: b["ms"] / 1000 for b in result["bars"]}
    pts = sorted((plan["bars"][i]["ms"] / 1000, s) for i, s in by_bar.items() if i < len(plan["bars"]))
    kept: list[tuple[float, float]] = []
    for tab, song in pts:
        if not kept or (tab > kept[-1][0] and song > kept[-1][1]):
            kept.append((tab, song))
    if not kept:
        return tab_s + result["offset_ms"] / 1000
    t = np.array([p[0] for p in kept])
    s = np.array([p[1] for p in kept])
    if len(kept) == 1:
        return s[0] + (tab_s - t[0])
    out = np.interp(tab_s, t, s)

    def slope(i: int, j: int) -> float:
        k = (t[j] - t[i]) / (s[j] - s[i])  # tab per song, as tabSync's edgeSlope
        return 1 / max(0.5, min(2.0, k))

    out = np.where(tab_s < t[0], s[0] + (tab_s - t[0]) * slope(0, 1), out)
    out = np.where(tab_s > t[-1], s[-1] + (tab_s - t[-1]) * slope(-2, -1), out)
    return out


def errors_ms(result: dict, plan: dict, tab_points: list[float], truth: list[float]) -> np.ndarray:
    placed = tab_to_song(result, plan, np.array(tab_points))
    return np.abs(placed - np.array(truth)) * 1000


def summary(name: str, result: dict, bar_err: np.ndarray, beat_err: np.ndarray) -> dict:
    out = {
        "scenario": name,
        "confidence": result["confidence"],
        "offset_ms": result["offset_ms"],
        "bars_mean_ms": round(float(bar_err.mean()), 1),
        "bars_max_ms": round(float(bar_err.max()), 1),
        "beats_mean_ms": round(float(beat_err.mean()), 1),
        "beats_max_ms": round(float(beat_err.max()), 1),
    }
    if REPORT:
        print("\n" + json.dumps(out), file=sys.stderr)
    return out


def run(tab_bars: list, tab_bpms: list[float], song_bars: list, song_bpms: list[float], start_s: float, jitter_s: float, seed: int = 3):
    plan = plan_of(tab_bars, tab_bpms)
    events, beats, starts = performance(song_bars, song_bpms, start_s)
    audio = render(events, beats, starts[-1] + 4 * 60 / song_bpms[-1] + 3, jitter_s, seed)
    clean = {k: v for k, v in plan.items() if not k.startswith("_")}
    return plan, beats, starts, align.align(audio, clean)


class SyncMatchingRecording(unittest.TestCase):
    """The tab and the recording play the same notes."""

    def test_silent_intro_steady_tempo_with_jitter(self):
        # 3.2 s of silence, then 32 bars at 104 bpm; the tab says 104 too.
        bars = sections(("verse", 8), ("chorus", 8), ("verse", 8), ("chorus", 8))
        bpms = [104.0] * len(bars)
        plan, beats, starts, r = run(bars, bpms, bars, bpms, INTRO_S, 0.015)
        bar_err = errors_ms(r, plan, [b["ms"] / 1000 for b in plan["bars"]], starts)
        beat_err = errors_ms(r, plan, plan["_beats"], beats)
        s = summary("intro 3.2 s, 104 bpm, 15 ms jitter", r, bar_err, beat_err)
        self.assertGreaterEqual(r["confidence"], LINED_UP, json.dumps(r["scores"]))
        self.assertLess(s["beats_mean_ms"], MEAN_MS, s)
        self.assertLess(s["beats_max_ms"], MAX_MS, s)
        self.assertLess(s["bars_max_ms"], MAX_MS, s)

    def test_tab_written_at_another_tempo(self):
        # The tab says 96 bpm, the band plays 108: every bar has to be
        # stretched, not just the first one placed.
        bars = sections(("verse", 8), ("chorus", 8), ("verse", 8), ("chorus", 8))
        plan, beats, starts, r = run(bars, [96.0] * 32, bars, [108.0] * 32, INTRO_S, 0.015)
        bar_err = errors_ms(r, plan, [b["ms"] / 1000 for b in plan["bars"]], starts)
        beat_err = errors_ms(r, plan, plan["_beats"], beats)
        s = summary("tab 96 bpm, recording 108 bpm", r, bar_err, beat_err)
        self.assertGreaterEqual(r["confidence"], LINED_UP, json.dumps(r["scores"]))
        self.assertLess(s["beats_mean_ms"], MEAN_MS, s)
        self.assertLess(s["beats_max_ms"], MAX_MS, s)

    def test_tempo_change_mid_song(self):
        # 16 bars at 100 bpm, then the chorus at 132, in the tab and the song.
        bars = sections(("verse", 16), ("chorus", 16))
        bpms = [100.0] * 16 + [132.0] * 16
        plan, beats, starts, r = run(bars, bpms, bars, bpms, INTRO_S, 0.015)
        bar_err = errors_ms(r, plan, [b["ms"] / 1000 for b in plan["bars"]], starts)
        beat_err = errors_ms(r, plan, plan["_beats"], beats)
        s = summary("tempo change 100 -> 132 bpm at bar 17", r, bar_err, beat_err)
        self.assertGreaterEqual(r["confidence"], LINED_UP, json.dumps(r["scores"]))
        self.assertLess(s["beats_mean_ms"], MEAN_MS, s)
        self.assertLess(s["beats_max_ms"], MAX_MS, s)


class SyncDifferentRecording(unittest.TestCase):
    """The recording has something the tab does not."""

    def intro_bars(self, extra: int):
        # The band plays `extra` bars of a chord the tab leaves out, then
        # the tab's song: bar 1 of the tab is that many bars in.
        tab = sections(("verse", 8), ("chorus", 8), ("verse", 8), ("chorus", 8))
        song = sections(("bridge", extra)) + tab
        bpms = [104.0] * len(song)
        plan, beats, starts, r = run(tab, bpms[: len(tab)], song, bpms, INTRO_S, 0.015)
        beats, starts = beats[4 * extra :], starts[extra:]
        bar_err = errors_ms(r, plan, [b["ms"] / 1000 for b in plan["bars"]], starts)
        beat_err = errors_ms(r, plan, plan["_beats"], beats)
        s = summary(f"{extra} extra intro bar(s) in the recording", r, bar_err, beat_err)
        self.assertGreaterEqual(r["confidence"], LINED_UP, json.dumps(r["scores"]))
        self.assertLess(s["beats_mean_ms"], MEAN_MS, s)
        self.assertLess(s["beats_max_ms"], MAX_MS, s)

    def test_one_extra_intro_bar(self):
        self.intro_bars(1)

    def test_two_extra_intro_bars(self):
        self.intro_bars(2)

    @unittest.expectedFailure
    def test_a_chorus_played_twice(self):
        # The tab: verse, chorus, verse, chorus. The band plays the first
        # chorus twice, so from bar 17 of the tab the song is 8 bars later.
        # align.py follows the tab in one line and cannot jump a repeat, so
        # the most it can do is get the part before the repeat right, or
        # admit it is lost with a confidence under "lined up". Today it
        # does neither: every bar half a bar out, confidence 100%. Kept as
        # an expected failure so the day it passes is noticed.
        tab = sections(("verse", 8), ("chorus", 8), ("verse", 8), ("chorus", 8))
        song = sections(("verse", 8), ("chorus", 8), ("chorus", 8), ("verse", 8), ("chorus", 8))
        bpms = [104.0] * len(song)
        plan, beats, starts, r = run(tab, bpms[: len(tab)], song, bpms, INTRO_S, 0.015)
        truth_bars = starts[:16] + starts[24:]
        truth_beats = beats[: 16 * 4] + beats[24 * 4 :]
        bar_err = errors_ms(r, plan, [b["ms"] / 1000 for b in plan["bars"]], truth_bars)
        beat_err = errors_ms(r, plan, plan["_beats"], truth_beats)
        s = summary("chorus played twice, tab has it once", r, bar_err, beat_err)
        before = float(bar_err[:16].mean())
        self.assertTrue(before < MEAN_MS or r["confidence"] < LINED_UP, {"before_repeat_mean_ms": round(before), **s})


class SyncWholeSong(unittest.TestCase):
    def test_a_four_minute_song(self):
        # 96 bars at 104 bpm (3.7 minutes) after the 3.2 s intro: a riff
        # that repeats for minutes fits about as well a few bars later, and
        # the start search used to pick one of those (31.7 s late, 91%).
        bars = sections(*[("verse", 8), ("chorus", 8)] * 6)
        bpms = [104.0] * len(bars)
        plan, beats, starts, r = run(bars, bpms, bars, bpms, INTRO_S, 0.015)
        bar_err = errors_ms(r, plan, [b["ms"] / 1000 for b in plan["bars"]], starts)
        beat_err = errors_ms(r, plan, plan["_beats"], beats)
        s = summary("3.7 minute song, 96 bars", r, bar_err, beat_err)
        self.assertGreaterEqual(r["confidence"], LINED_UP, json.dumps(r["scores"]))
        self.assertLess(s["beats_mean_ms"], MEAN_MS, s)
        self.assertLess(s["beats_max_ms"], MAX_MS, s)


if __name__ == "__main__":
    unittest.main()
