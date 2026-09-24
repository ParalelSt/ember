"""Loudness normalization: measure a cached song once, store the gain beside it.

Non-destructive, ReplayGain style. The audio file is never touched: ffmpeg's
ebur128 filter reads it once for its integrated loudness (LUFS) and true peak,
and the gain that brings it to TARGET_LUFS is written to a small sidecar,
`<MUSIC_DIR>/<videoId>.loudness.json`. The player applies that gain as a
volume multiplier, so a loud modern master and a quiet 80s one play at about
the same level.

    .venv/bin/python loudness.py <videoId>     # prints the sidecar JSON
"""
from __future__ import annotations

import json
import math
import os
import re
import subprocess
import sys
from pathlib import Path

from ffmpeg_path import ffmpeg_exe

# Spotify's and YouTube's reference level.
TARGET_LUFS = -14.0
# Never cut or boost more than this, whatever the measurement says.
MIN_GAIN_DB = -12.0
MAX_GAIN_DB = 6.0
# A boost may lift the true peak up to here and no further.
PEAK_CEILING_DB = -1.0
# ebur128 reports -70 LUFS for silence: nothing to normalize.
SILENCE_LUFS = -70.0

CACHE_EXTS = ("m4a", "webm", "opus", "mp3", "mp4")
SIDECAR_SUFFIX = ".loudness.json"
VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

_I_RE = re.compile(r"^\s*I:\s+(-?\d+(?:\.\d+)?|-inf)\s+LUFS", re.MULTILINE)
_PEAK_RE = re.compile(r"^\s*Peak:\s+(-?\d+(?:\.\d+)?|-inf|inf)\s+dBFS", re.MULTILINE)


def music_dir() -> Path:
    return Path(os.environ.get("MUSIC_DIR", Path(__file__).parent / "my_music"))


def parse_ebur128(stderr: str) -> tuple[float, float]:
    """(integrated LUFS, true peak dBFS) from ebur128's summary. The summary
    is the LAST block ffmpeg prints, so the last match wins."""
    i_matches = _I_RE.findall(stderr)
    p_matches = _PEAK_RE.findall(stderr)
    if not i_matches:
        raise ValueError("ffmpeg printed no integrated loudness")
    lufs = float(i_matches[-1])
    peak = float(p_matches[-1]) if p_matches else math.nan
    return lufs, peak


def compute_gain(lufs: float, peak: float | None) -> float:
    """dB to apply so the song plays at TARGET_LUFS.

    Clamped to MIN_GAIN_DB..MAX_GAIN_DB. A boost is also held back so the
    true peak stays under PEAK_CEILING_DB (never below 0: a quiet song with a
    hot peak just is not boosted). Silence, or a measurement that is not a
    number, gets 0."""
    if not math.isfinite(lufs) or lufs <= SILENCE_LUFS:
        return 0.0
    gain = min(MAX_GAIN_DB, max(MIN_GAIN_DB, TARGET_LUFS - lufs))
    if gain > 0 and peak is not None and not math.isnan(peak):
        headroom = PEAK_CEILING_DB - peak if math.isfinite(peak) else 0.0
        gain = max(0.0, min(gain, headroom))
    return round(gain, 2)


def measure(path: Path, exe: str | None = None, timeout: float = 120) -> tuple[float, float]:
    """Run ffmpeg's ebur128 over the whole file. Raises on failure."""
    exe = exe or ffmpeg_exe()
    if not exe:
        raise RuntimeError("ffmpeg is missing: run ./update.sh")
    proc = subprocess.run(
        [exe, "-hide_banner", "-nostats", "-i", str(path), "-vn", "-sn", "-dn",
         "-af", "ebur128=peak=true:framelog=quiet", "-f", "null", "-"],
        capture_output=True, text=True, timeout=timeout,
    )
    if proc.returncode != 0:
        tail = (proc.stderr or "").strip().splitlines()[-1:] or ["no output"]
        raise RuntimeError(f"ffmpeg failed ({proc.returncode}): {tail[0][:200]}")
    return parse_ebur128(proc.stderr)


def cached_file(video_id: str, base: Path | None = None) -> Path | None:
    base = base or music_dir()
    for ext in CACHE_EXTS:
        p = base / f"{video_id}.{ext}"
        if p.exists():
            return p
    return None


def sidecar_path(video_id: str, base: Path | None = None) -> Path:
    return (base or music_dir()) / f"{video_id}{SIDECAR_SUFFIX}"


def analyze(video_id: str, base: Path | None = None) -> dict:
    """Measure the cached song and write its sidecar. Returns what was written.
    An existing sidecar is returned as is: a video's audio never changes."""
    if not VIDEO_ID_RE.match(video_id):
        raise ValueError("invalid videoId")
    base = base or music_dir()
    side = sidecar_path(video_id, base)
    if side.exists():
        try:
            return json.loads(side.read_text())
        except (OSError, ValueError):
            pass  # unreadable: measure again and overwrite it
    audio = cached_file(video_id, base)
    if not audio:
        raise FileNotFoundError(f"{video_id} is not downloaded")
    lufs, peak = measure(audio)
    result = {
        "lufs": lufs if math.isfinite(lufs) else None,
        "peakDb": peak if math.isfinite(peak) else None,
        "gainDb": compute_gain(lufs, peak),
        "targetLufs": TARGET_LUFS,
    }
    # Write-then-rename so a reader never sees half a file.
    tmp = side.with_name(side.name + ".tmp")
    tmp.write_text(json.dumps(result))
    os.replace(tmp, side)
    return result


def main(argv: list[str]) -> int:
    ids = [a for a in argv if a != "--"]
    if len(ids) != 1:
        print("usage: loudness.py <videoId>", file=sys.stderr)
        return 2
    try:
        json.dump(analyze(ids[0]), sys.stdout)
    except Exception as e:  # one readable line for the Node parent
        print(f"ERROR: loudness: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
