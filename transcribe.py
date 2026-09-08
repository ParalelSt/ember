#!/usr/bin/env python3
"""Turn a recording into a guitar tab (alphaTex) that AlphaTab can render.

    .venv/bin/python transcribe.py <audio> <out.alphatex> [--skip-separation] [--title T]

Pipeline: ffmpeg decodes to wav -> Demucs keeps the guitar stem (optional) ->
Basic Pitch turns it into note events -> librosa tracks the beats of the mix ->
notes are placed on strings and quantized to 16ths -> alphaTex text.

Honest scope: a playable, in-time approximation of the guitar part. A human
transcription is better, which is why uploads stay in the app.

Prints one JSON line on success. Exits 1 with one line on stderr on failure.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile

# String 1 (high e) .. string 6 (low E), as MIDI numbers. Standard tuning only.
STRINGS = [64, 59, 55, 50, 45, 40]
MAX_FRET = 24
SLOTS_PER_BEAT = 4          # 16th notes
BEATS_PER_BAR = 4           # 4/4
FALLBACK_BPM = 120.0
DURATION_TOKEN = {16: "1", 8: "2", 4: "4", 2: "8", 1: "16"}   # slots -> alphaTex duration


def fail(msg: str) -> None:
    print(msg, file=sys.stderr)
    sys.exit(1)


def place(pitch: int):
    """(fret, string) for a MIDI pitch: the lowest fret that fits; on a tie the
    lower (higher-numbered) string, so an A2 is the open A, not the E at 5."""
    best = None
    for string, open_pitch in enumerate(STRINGS, start=1):
        fret = pitch - open_pitch
        if 0 <= fret <= MAX_FRET and (best is None or fret < best[0] or (fret == best[0] and string > best[1])):
            best = (fret, string)
    return best


def beat_grid(beats: list[float], duration: float) -> list[float]:
    """Beat times covering [0, duration]. Tracked beats are extended in both
    directions with their median spacing; too few beats means a 120 BPM grid,
    which is what a two-second test clip or a beatless intro gets."""
    if len(beats) < 8:
        step = 60.0 / FALLBACK_BPM
        return [i * step for i in range(int(duration / step) + 2)]
    gaps = sorted(b - a for a, b in zip(beats, beats[1:]))
    step = gaps[len(gaps) // 2]
    grid = list(beats)
    while grid[0] - step > 0:
        grid.insert(0, grid[0] - step)
    while grid[-1] < duration + step:
        grid.append(grid[-1] + step)
    return grid


def to_alphatex(notes, beats: list[float], title: str) -> str:
    """notes: (start_sec, end_sec, midi_pitch). Returns the alphaTex document."""
    # Slot every note onto the 16th grid inside its beat, and give it a length
    # in slots (at least one).
    events: dict[int, dict[int, tuple[int, int]]] = {}   # slot -> {string: (fret, length)}
    for start, end, pitch in notes:
        placed = place(int(pitch))
        if placed is None:
            continue
        fret, string = placed
        i = max(0, min(len(beats) - 2, _beat_index(beats, start)))
        beat_len = beats[i + 1] - beats[i]
        slot = i * SLOTS_PER_BEAT + min(SLOTS_PER_BEAT - 1, int((start - beats[i]) / beat_len * SLOTS_PER_BEAT))
        length = max(1, round((end - start) / (beat_len / SLOTS_PER_BEAT)))
        chord = events.setdefault(slot, {})
        # Two notes fighting for one string: keep the first. One string can
        # only sound one note, and the notes arrive sorted by onset.
        chord.setdefault(string, (fret, length))

    if not events:
        return f'\\title "{_q(title)}"\n\\tempo {int(FALLBACK_BPM)}\n.\nr.1 |\n'

    slots_per_bar = SLOTS_PER_BEAT * BEATS_PER_BAR
    last_slot = max(events)
    n_bars = last_slot // slots_per_bar + 1
    lines = [f'\\title "{_q(title)}"', f"\\tempo {_bar_tempo(beats, 0)}", "."]

    for bar in range(n_bars):
        bar_start = bar * slots_per_bar
        tokens = [f"\\tempo {_bar_tempo(beats, bar)}"]
        pos = bar_start
        while pos < bar_start + slots_per_bar:
            remaining = bar_start + slots_per_bar - pos
            # Next event inside this bar, if any, caps how long anything can last.
            upcoming = [s for s in events if pos < s < bar_start + slots_per_bar]
            until_next = (min(upcoming) - pos) if upcoming else remaining
            chord = events.get(pos)
            if chord:
                longest = max(length for _, length in chord.values())
                d = _snap(min(longest, until_next))
                parts = [f"{fret}.{string}" for string, (fret, _) in sorted(chord.items())]
                tokens.append(f"({' '.join(parts)}).{DURATION_TOKEN[d]}" if len(parts) > 1 else f"{parts[0]}.{DURATION_TOKEN[d]}")
            else:
                d = _snap(until_next)
                tokens.append(f"r.{DURATION_TOKEN[d]}")
            pos += d
        lines.append(" ".join(tokens) + " |")
    return "\n".join(lines) + "\n"


def _beat_index(beats: list[float], t: float) -> int:
    lo, hi = 0, len(beats) - 1
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if beats[mid] <= t:
            lo = mid
        else:
            hi = mid - 1
    return lo


def _snap(slots: int) -> int:
    """Largest power of two (1..16 slots) not above `slots`. Anything left over
    becomes the next token, so timing never drifts."""
    for d in (16, 8, 4, 2, 1):
        if slots >= d:
            return d
    return 1


def _bar_tempo(beats: list[float], bar: int) -> int:
    """Tempo of one bar from its measured beat lengths. Per bar rather than one
    global BPM so the cursor follows this recording instead of drifting."""
    i = bar * BEATS_PER_BAR
    j = min(len(beats) - 1, i + BEATS_PER_BAR)
    if j <= i:
        return int(FALLBACK_BPM)
    return max(30, min(300, round(60.0 * (j - i) / (beats[j] - beats[i]))))


def _q(s: str) -> str:
    return s.replace("\\", " ").replace('"', "'")


# ── the pipeline ─────────────────────────────────────────────────────────────

def decode(src: str, dst: str) -> None:
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        fail("ffmpeg is not installed")
    r = subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-i", src, "-ac", "2", "-ar", "44100", dst],
                       capture_output=True, text=True)
    if r.returncode != 0:
        detail = r.stderr.strip().splitlines()[-1] if r.stderr.strip() else "ffmpeg failed"
        fail(f"could not decode the audio: {detail}")


def guitar_stem(mix_wav: str, out_wav: str) -> str:
    """Path of the audio to transcribe: the Demucs guitar stem, or the mix when
    Demucs is not installed (said on stderr so the log explains the quality)."""
    try:
        from demucs.api import Separator, save_audio  # type: ignore
    except ImportError:
        print("demucs not installed; transcribing the full mix", file=sys.stderr)
        return mix_wav
    separator = Separator(model="htdemucs_6s", device="cpu", progress=False)
    _, stems = separator.separate_audio_file(mix_wav)
    save_audio(stems["guitar"], out_wav, samplerate=separator.samplerate)
    return out_wav


def transcribe(wav: str):
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import predict
    _, _, note_events = predict(
        wav, ICASSP_2022_MODEL_PATH,
        onset_threshold=0.6, frame_threshold=0.4, minimum_note_length=80,
        minimum_frequency=80.0, maximum_frequency=1350.0,   # E2 .. a little above E6
    )
    return [(float(s), float(e), int(p)) for s, e, p, _amp, _bends in note_events]


def track_beats(wav: str):
    import librosa
    y, sr = librosa.load(wav, sr=22050, mono=True)
    _, beat_times = librosa.beat.beat_track(y=y, sr=sr, units="time")
    return [float(b) for b in beat_times], float(len(y) / sr)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("audio")
    ap.add_argument("out")
    ap.add_argument("--skip-separation", action="store_true", help="transcribe the mix as-is (tests, or no Demucs)")
    ap.add_argument("--title", default="")
    args = ap.parse_args()

    if not os.path.isfile(args.audio):
        fail(f"no such audio file: {args.audio}")

    with tempfile.TemporaryDirectory(prefix="ember-transcribe-") as tmp:
        mix = os.path.join(tmp, "mix.wav")
        decode(args.audio, mix)
        source = mix if args.skip_separation else guitar_stem(mix, os.path.join(tmp, "guitar.wav"))
        notes = transcribe(source)
        beats, duration = track_beats(mix)

    grid = beat_grid(beats, duration)
    title = args.title or os.path.splitext(os.path.basename(args.audio))[0]
    text = to_alphatex(sorted(notes), grid, title)

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    # Write beside, then rename: a reader must never see a half-written tab.
    partial = args.out + ".partial"
    with open(partial, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(partial, args.out)

    print(json.dumps({"notes": len(notes), "bars": text.count("|"), "tempo": _bar_tempo(grid, 0)}))


if __name__ == "__main__":
    main()
