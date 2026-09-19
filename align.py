#!/usr/bin/env python3
"""Line a tab up with a recording (docs/tabs-v3.md section 3).

    .venv/bin/python align.py <audio> <plan.json> <out.json>

The tab gives the notes, the audio gives the time. `plan.json` is the tab
as AlphaTab plays it (apps/web/lib/tabPlan.ts): every bar's start and every
struck beat's time and pitches on the tab's own clock. The audio is decoded
with Ember's ffmpeg (ffmpeg_path.py) unless it is already a wav.

1. Two onset curves of the recording: the whole mix (librosa onset
   strength, 5.8 ms frames) and, mostly, the harmonic part alone (HPSS),
   which is where pitched notes start and drums do not.
2. The start: the tab's first 30 s of onsets are correlated with the curve
   at every tempo ratio from 0.8 to 1.25 and every start in the first 90 s;
   the strongest peaks and the earliest strong ones (a riff that repeats
   fits at every repeat) are each followed through the whole song, and the
   best sum of onsets, span of the recording and chroma puts bar 1.
3. Anchors: the bars are followed one at a time, each placed where eight
   bars around it fit the curve best, within a tenth of a second of the
   pace so far, so a recording that drifts stays lined up and a riff an
   eighth note out does not pull a bar over. Each bar is then placed
   finely on the mix's own sharp onsets.
4. Confidence, 0 to 1: how many of the tab's onsets land on an onset of the
   recording (against chance), and how much better the tab's pitches match
   the recording's chroma than the same tab in the other eleven keys.

The recording's tempo comes from librosa's beat tracker (transcribe.py's
track_beats), for the report only.

Writes `out.json`: {offset_ms, bpm, confidence, bars: [{bar, ms}], scores}
and prints it as one line. Exits 1 with one line on stderr on failure.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile

import numpy as np

from ffmpeg_path import MISSING as FFMPEG_MISSING, ffmpeg_exe

SR = 22050
HOP = 128                    # 5.8 ms onset frames
FPS = SR / HOP
N_FFT = 1024
CHROMA_HOP = 512
# How late librosa's onset curve peaks after the true onset (its spectral
# flux and the smoothing), measured on the synthetic clicks and plucks of
# tests/test_align.py: the curve is read this much later than the note.
ONSET_LAG_S = 0.010
HARM_HOP = 512               # the harmonic onset curve's frames (23 ms)
MAX_HARM_LAG_S = 0.15        # how far the harmonic curve may lag the mix's
MIX_WEIGHT = 0.25            # the whole mix's onsets beside the harmonic ones
QUIET_SHARE = 0.4            # a window this much quieter than usual moves nothing
POLISH_S = 0.07              # last, each bar is placed this finely on the mix

SEARCH_START_S = 90.0        # the tab's first note may be this late into the recording
SCALES = np.arange(0.80, 1.2501, 0.002)    # recording seconds per tab second
WINDOW_S = 30.0              # the tab's first seconds that find the start
TOP_CANDIDATES = 30          # the strongest distinct starts, refined on the first bars
EARLIEST_CANDIDATES = 12     # and the earliest strong ones
NEAR_BEST = 0.7              # starts this close to the best are followed through the song
FOLLOW_CANDIDATES = 8
WINDOW_BARS = 8              # bars of evidence for each placement
REFINE_S = 0.1               # each start is refined this far on the first bars
FOLLOW_SHIFT_S = 0.12        # a bar may start this far from where the one before put it
FOLLOW_PACE = 0.03           # and its window run this much faster or slower
HIT_S = 0.05                 # an onset "lands" within 50 ms


def fail(msg: str) -> None:
    print(msg, file=sys.stderr)
    sys.exit(1)


# ── audio ────────────────────────────────────────────────────────────────────

def load_audio(path: str) -> np.ndarray:
    """Mono float audio at SR. A wav is read directly; anything else is
    decoded by Ember's ffmpeg first."""
    import librosa
    if path.lower().endswith(".wav"):
        y, _ = librosa.load(path, sr=SR, mono=True)
        return y
    ffmpeg = ffmpeg_exe()
    if not ffmpeg:
        fail(FFMPEG_MISSING)
    with tempfile.TemporaryDirectory(prefix="ember-align-") as tmp:
        wav = os.path.join(tmp, "mix.wav")
        r = subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", path, "-ac", "1", "-ar", str(SR), wav],
                           capture_output=True, text=True)
        if r.returncode != 0:
            detail = r.stderr.strip().splitlines()[-1] if r.stderr.strip() else "ffmpeg failed"
            fail(f"could not decode the audio: {detail}")
        y, _ = librosa.load(wav, sr=SR, mono=True)
    return y


def onset_curve(y: np.ndarray) -> np.ndarray:
    """The onset strength, with its slow background taken out and scaled to
    unit spread, lightly smoothed so a few ms either way still counts."""
    import librosa
    from scipy.ndimage import gaussian_filter1d, median_filter
    env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP, n_fft=N_FFT)
    env = env - median_filter(env, size=int(0.4 * FPS) | 1)
    env = np.maximum(env, 0.0)
    spread = float(np.std(env))
    if spread > 1e-9:
        env = env / spread
    return gaussian_filter1d(env, 1.5)


def harmonic_curve(y: np.ndarray, frames: int) -> np.ndarray:
    """The onset curve of the recording's harmonic part only (librosa's
    median-filter HPSS on the spectrogram): the attacks of pitched notes,
    which is what a tab has, without the drums, which a tab does not. On the
    onset curve's own time grid, not yet shifted (its longer frames see an
    attack late, by how much depends on the instruments: harm_lag)."""
    import librosa
    from scipy.ndimage import median_filter
    S = np.abs(librosa.stft(y, n_fft=2048, hop_length=HARM_HOP))
    H, _ = librosa.decompose.hpss(S, kernel_size=(17, 17))
    mel = librosa.feature.melspectrogram(S=H ** 2, sr=SR)
    env = librosa.onset.onset_strength(S=librosa.power_to_db(mel), sr=SR, hop_length=HARM_HOP)
    fps = SR / HARM_HOP
    env = np.maximum(0.0, env - median_filter(env, size=int(0.4 * fps) | 1))
    spread = float(np.std(env))
    if spread > 1e-9:
        env = env / spread
    return np.interp(np.arange(frames) / FPS * fps, np.arange(len(env)), env, left=0.0, right=0.0)


def harm_lag(mix: np.ndarray, harm: np.ndarray) -> float:
    """How much later the harmonic curve sees the same attacks as the mix's
    (its frames are four times longer, and a bass note rises slower than a
    drum): the shift, up to MAX_HARM_LAG_S, where the two agree most. The
    mix's own lag is already in ONSET_LAG_S."""
    n = int(MAX_HARM_LAG_S * FPS)
    if len(mix) < 4 * n or n < 2:
        return 0.0
    a = mix[n : len(mix) - n]
    scores = [float(a @ harm[n + d : len(mix) - n + d]) for d in range(-n, n + 1)]
    return (int(np.argmax(scores)) - n) / FPS


def shifted(env: np.ndarray, lag: float) -> np.ndarray:
    """The curve read `lag` later, on the same grid."""
    if abs(lag) < 1e-6:
        return env
    return np.interp(np.arange(len(env)) + lag * FPS, np.arange(len(env)), env, left=0.0, right=0.0)


def onset_peaks(env: np.ndarray) -> np.ndarray:
    """Onset times (s) of the recording: local peaks of the curve that stand
    out from their surroundings."""
    import librosa
    idx = librosa.util.peak_pick(env, pre_max=6, post_max=6, pre_avg=40, post_avg=40, delta=0.5, wait=10)
    return idx / FPS


def audio_chroma(y: np.ndarray) -> np.ndarray:
    import librosa
    return librosa.feature.chroma_stft(y=y, sr=SR, hop_length=CHROMA_HOP, n_fft=4096)


def recording_tempo(y: np.ndarray) -> float:
    """The recording's tempo from librosa's beat tracker (transcribe.py's
    track_beats), or 0 when it finds no beat."""
    import librosa
    tempo, _ = librosa.beat.beat_track(y=y, sr=SR)
    t = float(np.atleast_1d(tempo)[0]) if np.size(tempo) else 0.0
    return t if np.isfinite(t) else 0.0


# ── the tab ──────────────────────────────────────────────────────────────────

class Tab:
    def __init__(self, plan: dict):
        self.bars = np.array([b["ms"] for b in plan.get("bars", [])], dtype=float) / 1000.0
        notes = plan.get("notes", [])
        self.onsets = np.array([n["ms"] for n in notes], dtype=float) / 1000.0
        self.durs = np.array([max(0.05, n.get("dur", 250) / 1000.0) for n in notes], dtype=float)
        self.pitches = [n.get("p", []) for n in notes]
        self.end = float(plan.get("endMs", 0)) / 1000.0 or (float(self.onsets[-1]) + 2.0 if len(self.onsets) else 0.0)
        self.tempo = float(plan.get("tempo", 120) or 120)
        if len(self.bars) == 0:
            self.bars = np.array([0.0])

    def bar_of(self, t: np.ndarray) -> np.ndarray:
        return np.clip(np.searchsorted(self.bars, t, side="right") - 1, 0, len(self.bars) - 1)

    def bar_chroma(self) -> np.ndarray:
        """Per bar, the pitch classes struck, weighted by how long they ring."""
        out = np.zeros((len(self.bars), 12))
        bars = self.bar_of(self.onsets)
        for i, (b, ps) in enumerate(zip(bars, self.pitches)):
            for p in ps:
                out[b, int(p) % 12] += min(self.durs[i], 1.0)
        return out


# ── scoring ──────────────────────────────────────────────────────────────────

def sample(env: np.ndarray, t: np.ndarray) -> np.ndarray:
    """The onset curve at times `t` (s), linearly interpolated, 0 outside."""
    f = (t + ONSET_LAG_S) * FPS
    return np.interp(f, np.arange(len(env)), env, left=0.0, right=0.0)


def span_mean(env: np.ndarray, lo: float, hi: float) -> float:
    """The onset curve's average over a stretch of the recording: what a
    tab's onsets would score there by chance, so scores from a quiet verse
    and a busy chorus can be compared."""
    a = max(0, int(lo * FPS))
    b = min(len(env), int(hi * FPS) + 1)
    return float(env[a:b].mean()) if b > a + 1 else 1.0


def chroma_score(tab_chroma: np.ndarray, starts: np.ndarray, chroma: np.ndarray, rotate: int = 0) -> float:
    """Mean cosine between each bar's tab chroma (rotated by `rotate`
    semitones) and the recording's chroma over that bar, bars with notes."""
    fps = SR / CHROMA_HOP
    sims = []
    for b in range(len(starts) - 1):
        v = tab_chroma[b]
        if v.sum() <= 0:
            continue
        lo, hi = int(starts[b] * fps), int(starts[b + 1] * fps)
        if lo < 0 or hi > chroma.shape[1] or hi - lo < 2:
            continue
        a = chroma[:, lo:hi].mean(axis=1)
        v = np.roll(v, rotate)
        na, nv = np.linalg.norm(a), np.linalg.norm(v)
        if na > 0 and nv > 0:
            sims.append(float(a @ v / (na * nv)))
    return float(np.mean(sims)) if sims else 0.0


def key_contrast(tab_chroma: np.ndarray, starts: np.ndarray, chroma: np.ndarray) -> float:
    """How far the tab's own key stands out from the same tab in the other
    eleven, in standard deviations of those eleven (0 when it does not)."""
    own = chroma_score(tab_chroma, starts, chroma)
    others = np.array([chroma_score(tab_chroma, starts, chroma, r) for r in range(1, 12)])
    sd = float(others.std()) or 1e-3
    return max(0.0, (own - float(others.mean())) / sd)


def to_song(tab_t: np.ndarray, anchor_t: np.ndarray, anchor_s: np.ndarray) -> np.ndarray:
    """Tab time to song time over anchors, linear beyond them at the edge pace."""
    s = np.interp(tab_t, anchor_t, anchor_s)
    if len(anchor_t) >= 2:
        k0 = (anchor_s[1] - anchor_s[0]) / max(1e-6, anchor_t[1] - anchor_t[0])
        k1 = (anchor_s[-1] - anchor_s[-2]) / max(1e-6, anchor_t[-1] - anchor_t[-2])
        s = np.where(tab_t < anchor_t[0], anchor_s[0] + (tab_t - anchor_t[0]) * k0, s)
        s = np.where(tab_t > anchor_t[-1], anchor_s[-1] + (tab_t - anchor_t[-1]) * k1, s)
    return s


# ── 2. offset and tempo ──────────────────────────────────────────────────────

def window_score(env: np.ndarray, rel: np.ndarray, starts: np.ndarray, paces: np.ndarray) -> np.ndarray:
    """Mean onset curve under the onsets `rel` (s from a bar's start) laid
    from every start (rows) at every pace (columns)."""
    t = starts[:, None, None] + paces[None, :, None] * rel[None, None, :]
    return sample(env, t).mean(axis=2)


def start_candidates(tab: Tab, env: np.ndarray) -> list[tuple[float, float, float]]:
    """(score, scale, song time of the tab's 0): the strongest peaks of the
    tab's first WINDOW_S seconds of onsets correlated with the onset curve,
    at every scale, the first note anywhere in the first SEARCH_START_S."""
    from scipy.signal import fftconvolve, find_peaks
    t0 = float(tab.onsets[0])
    rel = tab.onsets[tab.onsets <= t0 + WINDOW_S] - t0
    if len(rel) < 4:
        return []
    audio_len = len(env) / FPS
    out = []
    for s in SCALES:
        pos = rel * s * FPS
        length = int(np.ceil(pos[-1])) + 2
        train = np.zeros(length)
        lo = np.floor(pos).astype(int)
        w = pos - lo
        np.add.at(train, lo, 1 - w)
        np.add.at(train, lo + 1, w)
        # corr[k] = sum_j train[j] * env[j + k]: the first note at frame k.
        corr = fftconvolve(env, train[::-1], mode="full")[length - 1:]
        k_max = int(min(len(corr) - 1, SEARCH_START_S * FPS))
        corr = corr[: k_max + 1] / len(rel)
        # Every clear peak, not just the highest: a riff that repeats has
        # one per repeat, all as high, and only the song decides.
        peaks, _ = find_peaks(corr, height=0.8 * float(corr.max()), distance=max(1, int(0.15 * FPS)))
        for k in peaks[np.argsort(corr[peaks])[::-1][:40]]:
            first = k / FPS
            if first > audio_len:
                continue
            out.append((float(corr[k]), float(s), first - t0 * s))
    if not out:
        return []

    def distinct(cands: list, limit: int) -> list:
        kept: list[tuple[float, float, float]] = []
        for c in cands:
            if all(abs(c[2] - d[2]) > 0.15 for d in kept):
                kept.append(c)
            if len(kept) >= limit:
                break
        return kept

    out.sort(key=lambda x: -x[0])
    # The strongest, and the earliest of the strong ones: a riff that
    # repeats fits as well at every repeat, and the song starts at the first.
    strong = [c for c in out if c[0] >= 0.85 * out[0][0]]
    earliest = distinct(sorted(strong, key=lambda c: (round(c[2], 1), -c[0])), EARLIEST_CANDIDATES)
    return distinct(out, TOP_CANDIDATES) + [c for c in earliest if all(abs(c[2] - d[2]) > 0.15 for d in distinct(out, TOP_CANDIDATES))]


def first_window(tab: Tab) -> tuple[int, int]:
    """The first WINDOW_BARS bars from the first bar with a note."""
    first = int(tab.bar_of(np.array([tab.onsets[0]]))[0])
    return first, min(len(tab.bars), first + WINDOW_BARS)


def window_onsets(tab: Tab, lo: int, hi: int) -> np.ndarray:
    end = tab.bars[hi] if hi < len(tab.bars) else tab.end + 1e-3
    m = (tab.onsets >= tab.bars[lo] - 1e-6) & (tab.onsets < end - 1e-6)
    return tab.onsets[m] - tab.bars[lo]


def refine(tab: Tab, env: np.ndarray, scale: float, zero: float) -> tuple[float, float, float]:
    """Around a coarse fit, the first window's best start and pace: (score,
    pace, song time of the tab's 0)."""
    lo, hi = first_window(tab)
    rel = window_onsets(tab, lo, hi)
    guess = zero + tab.bars[lo] * scale
    starts = guess + np.arange(-REFINE_S, REFINE_S + 1e-9, 0.005)
    paces = scale * (1 + np.arange(-0.04, 0.0401, 0.0025))
    grid = window_score(env, rel, starts, paces)
    i, j = np.unravel_index(int(np.argmax(grid)), grid.shape)
    # Sub-step start from the neighbours.
    x = starts[i]
    if 0 < i < len(starts) - 1:
        a, b, c = grid[i - 1, j], grid[i, j], grid[i + 1, j]
        den = a - 2 * b + c
        if den < 0:
            x += 0.005 * 0.5 * (a - c) / den
    # Against the recording's own loudness there: a busy chorus scores
    # higher than a quiet verse whether the tab fits it or not.
    score = float(grid[i, j]) / max(1e-6, span_mean(env, x, x + rel[-1] * paces[j]))
    return score, float(paces[j]), float(x - tab.bars[lo] * paces[j])


def whole_fit(tab: Tab, env: np.ndarray, peaks: np.ndarray, chroma: np.ndarray, zero: float, pace: float) -> dict:
    """Follow the bars from a start and score the whole song: the onset
    curve under every onset of the tab (none past the recording's end), how
    much of the recording's onsets the tab spans, and the chroma."""
    anchor_t, anchor_s = follow_bars(tab, env, pace, zero)
    song = to_song(tab.onsets, anchor_t, anchor_s)
    lo, hi = float(song.min()) - 0.5, float(song.max()) + 0.5
    onset = float(sample(env, song).mean()) / max(1e-6, span_mean(env, lo, hi))
    strong = peaks[sample(env, peaks) > 1.0] if len(peaks) else peaks
    covered = float(((strong >= lo) & (strong <= hi)).mean()) if len(strong) else 0.0
    tab_chroma = tab.bar_chroma()
    ends = np.append(anchor_s, anchor_s[-1] + (tab.end - tab.bars[-1]) * pace)
    chroma_sim = chroma_score(tab_chroma, ends, chroma) if tab_chroma.any() else 0.0
    return {"anchor_t": anchor_t, "anchor_s": anchor_s, "onset": onset, "covered": covered, "chroma": chroma_sim, "pace": pace}


def best_fit(tab: Tab, env: np.ndarray, peaks: np.ndarray, chroma: np.ndarray, cands: list) -> dict:
    """The start: every candidate refined on the first bars; those close to
    the best (a riff that repeats fits as well one repeat later) followed
    through the whole song, earliest first; the best sum of onsets (against
    the best of them), span of the recording's onsets and chroma wins, the
    earlier one on a near tie. A start one repeat late leaves the song's
    first bars unexplained and runs out of recording at the end."""
    refined = []
    for _, s, zero in cands:
        score, pace, z = refine(tab, env, s, zero)
        refined.append((score, pace, z))
    top_window = max(r[0] for r in refined)
    close = sorted({round(r[2], 2): r for r in refined if r[0] >= NEAR_BEST * top_window}.values(), key=lambda r: r[2])
    # The best few, and the earliest few: a song whose later half is busier
    # fits any tab better there, and the whole-song fit is the judge.
    chosen = sorted({id(r): r for r in close[: FOLLOW_CANDIDATES // 2] + sorted(close, key=lambda r: -r[0])[: FOLLOW_CANDIDATES // 2]}.values(), key=lambda r: r[2])
    fits = []
    for score, pace, z in chosen:
        fit = whole_fit(tab, env, peaks, chroma, z, pace)
        fit["window"] = score
        fits.append(fit)
    top = max(f["onset"] for f in fits) or 1.0
    best = None
    for f in fits:
        f["total"] = f["onset"] / top + 0.3 * f["covered"] + f["chroma"]
        if best is None or f["total"] > best["total"] + 0.005:
            best = f
    return best


# ── 3. anchors ───────────────────────────────────────────────────────────────

def follow_bars(tab: Tab, env: np.ndarray, scale: float, zero: float) -> tuple[np.ndarray, np.ndarray]:
    """Anchors (tab time, song time) at every bar. Each bar is placed where
    the next WINDOW_BARS bars' onsets fit the onset curve best, starting
    within FOLLOW_SHIFT_S of where the bar before and its pace put it and
    running at most FOLLOW_PACE faster or slower: many bars of evidence, so
    a riff an eighth note off does not pull a bar over, and small steps, so
    a band that drifts is followed."""
    n = len(tab.bars)
    song = np.empty(n)
    song[0] = zero + tab.bars[0] * scale
    pace = scale
    audio_len = len(env) / FPS
    shifts = np.arange(-FOLLOW_SHIFT_S, FOLLOW_SHIFT_S + 1e-9, 0.005)
    rel_paces = 1 + np.arange(-FOLLOW_PACE, FOLLOW_PACE + 1e-9, 0.0025)
    strength: list[float] = []
    for b in range(1, n):
        predicted = song[b - 1] + (tab.bars[b] - tab.bars[b - 1]) * pace
        # A window around the bar (three before, five from it): a tempo
        # that changes smoothly then pulls its start neither way.
        lo = max(0, b - WINDOW_BARS // 2 + 1)
        rel = window_onsets(tab, lo, min(n, lo + WINDOW_BARS)) + tab.bars[lo] - tab.bars[b]
        if len(rel) < 6 or predicted > audio_len:
            song[b] = predicted
            continue
        paces = pace * rel_paces
        grid = window_score(env, rel, predicted + shifts, paces)
        # A small pull towards the prediction: evidence has to be clear.
        grid = grid - 0.05 * np.abs(shifts)[:, None] / FOLLOW_SHIFT_S - 0.05 * np.abs(rel_paces - 1)[None, :] / FOLLOW_PACE
        i, j = np.unravel_index(int(np.argmax(grid)), grid.shape)
        strength.append(float(grid[i, j]))
        # Too little to hear (a fade, an outro the tab does not have): keep
        # the pace rather than chase noise.
        if len(strength) > 4 and grid[i, j] < QUIET_SHARE * float(np.median(strength[:-1])):
            song[b] = predicted
            continue
        song[b] = predicted + shifts[i]
        pace = 0.5 * pace + 0.5 * float(paces[j])
    # The first bar was placed by a window that only looks ahead: place it
    # again against its neighbours' pace, over its own and the next bar.
    if n >= 3:
        local = (song[2] - song[1]) / max(1e-6, tab.bars[2] - tab.bars[1])
        predicted = song[1] - (tab.bars[1] - tab.bars[0]) * local
        rel = window_onsets(tab, 0, 2)
        if len(rel) >= 4:
            grid = window_score(env, rel, predicted + shifts, np.array([local]))[:, 0]
            song[0] = predicted + shifts[int(np.argmax(grid))]
    return tab.bars.copy(), song


def polish(tab: Tab, env: np.ndarray, anchor_t: np.ndarray, anchor_s: np.ndarray) -> np.ndarray:
    """The bars placed on the whole mix's onsets, which are sharp in time:
    each bar with the two either side of it moved as one by at most
    POLISH_S (less than an eighth note at any tempo a tab has, so nothing
    jumps a note), the moves smoothed over five bars."""
    from scipy.ndimage import median_filter
    n = len(anchor_t)
    if n < 2:
        return anchor_s
    shifts = np.arange(-POLISH_S, POLISH_S + 1e-9, 0.0025)
    moves = np.zeros(n)
    for b in range(n):
        lo, hi = max(0, b - 2), min(n, b + 3)
        end = anchor_t[hi] if hi < n else tab.end + 1e-3
        m = (tab.onsets >= anchor_t[lo] - 1e-6) & (tab.onsets < end - 1e-6)
        if m.sum() < 4:
            continue
        song = to_song(tab.onsets[m], anchor_t, anchor_s)
        score = sample(env, song[None, :] + shifts[:, None]).mean(axis=1)
        moves[b] = shifts[int(np.argmax(score))]
    return anchor_s + median_filter(moves, size=5, mode="nearest")


# ── 4. confidence ────────────────────────────────────────────────────────────

def onset_agreement(tab: Tab, peaks: np.ndarray, anchor_t: np.ndarray, anchor_s: np.ndarray, audio_len: float) -> tuple[float, float]:
    """(hit rate of the tab's onsets on the recording's, the same by chance)."""
    t = to_song(tab.onsets, anchor_t, anchor_s)
    inside = (t >= 0) & (t <= audio_len)
    if inside.sum() < 4 or len(peaks) == 0:
        return 0.0, 1.0
    t = t[inside]
    idx = np.clip(np.searchsorted(peaks, t), 1, len(peaks) - 1)
    near = np.minimum(np.abs(peaks[idx] - t), np.abs(peaks[idx - 1] - t))
    hits = float((near <= HIT_S).mean())
    lo, hi = float(t.min()), float(t.max())
    span = max(1.0, hi - lo)
    in_span = peaks[(peaks >= lo - HIT_S) & (peaks <= hi + HIT_S)]
    # The share of the span within HIT_S of a peak: what a random onset hits.
    covered = np.zeros(int(span * 1000) + 1, dtype=bool)
    for p in in_span:
        a = int(max(0, (p - HIT_S - lo) * 1000))
        b = int(min(len(covered), (p + HIT_S - lo) * 1000 + 1))
        covered[a:b] = True
    return hits, float(covered.mean())


def confidence_of(hits: float, chance: float, contrast: float, pitched: bool) -> float:
    """Onsets: the hits above chance, where 60% of the way from chance to
    every onset counts as full marks (a mix hides some of any one part's
    notes). Pitches: the tab's key standing 3 standard deviations above the
    other eleven is full marks. A tab with pitches needs both: onsets alone
    are too easy to find in a busy recording."""
    onset = float(np.clip((hits - chance) / max(1e-6, 0.6 * (1 - chance)), 0, 1))
    if not pitched:
        return onset
    key = float(np.clip(contrast / 3.0, 0, 1))
    return float(np.clip(onset * (0.3 + 0.7 * key), 0, 1))


# ── main ─────────────────────────────────────────────────────────────────────

def align(y: np.ndarray, plan: dict) -> dict:
    tab = Tab(plan)
    audio_len = len(y) / SR
    empty = {"offset_ms": 0, "bpm": 0, "confidence": 0.0, "bars": [], "scores": {}}
    if len(tab.onsets) < 4 or audio_len < 2 or float(np.max(np.abs(y))) < 1e-4:
        return empty
    mix = onset_curve(y)
    if not mix.any():
        return empty
    harm = harmonic_curve(y, len(mix))
    lag = harm_lag(mix, harm)
    env = shifted(harm, lag) + MIX_WEIGHT * mix
    chroma = audio_chroma(y)
    peaks = onset_peaks(env)
    cands = start_candidates(tab, env)
    if not cands:
        return empty
    fit = best_fit(tab, env, peaks, chroma, cands)
    anchor_t = fit["anchor_t"]
    anchor_s = polish(tab, mix, anchor_t, fit["anchor_s"])
    scale = fit["pace"]
    hits, chance = onset_agreement(tab, onset_peaks(mix), anchor_t, anchor_s, audio_len)
    tab_chroma = tab.bar_chroma()
    pitched = bool(tab_chroma.any())
    ends = np.append(anchor_s, anchor_s[-1] + (tab.end - tab.bars[-1]) * scale)
    contrast = key_contrast(tab_chroma, ends, chroma) if pitched else 0.0
    conf = confidence_of(hits, chance, contrast, pitched)
    span = (anchor_s[-1] - anchor_s[0]) / max(1e-6, anchor_t[-1] - anchor_t[0]) if len(anchor_t) > 1 else scale
    bars = [{"bar": int(i), "ms": int(round(s * 1000))} for i, s in enumerate(anchor_s) if s <= audio_len + 1]
    return {
        "offset_ms": int(round(anchor_s[0] * 1000)),
        "bpm": round(tab.tempo / span, 2),
        "confidence": round(conf, 3),
        "bars": bars,
        "scores": {
            "hits": round(hits, 3),
            "chance": round(chance, 3),
            "key_contrast": round(contrast, 2),
            "onset": round(fit["onset"], 3),
            "window": round(fit["window"], 3),
            "covered": round(fit["covered"], 3),
            "chroma": round(fit["chroma"], 3),
            "scale": round(scale, 4),
            "tracked_bpm": round(recording_tempo(y), 1),
            "harm_lag_ms": round(lag * 1000),
        },
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("audio")
    ap.add_argument("plan")
    ap.add_argument("out")
    args = ap.parse_args()
    if not os.path.isfile(args.audio):
        fail(f"no such audio file: {args.audio}")
    try:
        with open(args.plan, encoding="utf-8") as f:
            plan = json.load(f)
    except (OSError, ValueError) as e:
        fail(f"could not read the tab plan: {e}")
    y = load_audio(args.audio)
    result = align(y, plan)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    partial = args.out + ".partial"
    with open(partial, "w", encoding="utf-8") as f:
        json.dump(result, f)
    os.replace(partial, args.out)
    print(json.dumps({k: result[k] for k in ("offset_ms", "bpm", "confidence")} | {"bars": len(result["bars"])}))


if __name__ == "__main__":
    main()
