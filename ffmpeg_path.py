"""Where ffmpeg is, for player.py (yt-dlp) and transcribe.py (decoding).

Ember brings its own ffmpeg: the `imageio-ffmpeg` pip package ships a static
binary, so a host never installs one by hand. The system ffmpeg on PATH is
the fallback. update.sh installs the package and links the binary to
`.venv/bin/ffmpeg` too, for anything that looks it up by PATH.

    .venv/bin/python ffmpeg_path.py      # prints the path, exit 1 if none
"""
from __future__ import annotations

import os
import shutil
import sys

MISSING = "ffmpeg is missing: run ./update.sh"


def bundled_ffmpeg() -> str | None:
    """The binary imageio-ffmpeg ships, or None when the package is missing."""
    try:
        import imageio_ffmpeg  # type: ignore
        exe = imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # not installed, or its binary is gone
        return None
    return exe if exe and os.path.isfile(exe) and os.access(exe, os.X_OK) else None


def ffmpeg_exe() -> str | None:
    """The bundled ffmpeg first, then whatever `ffmpeg` is on PATH."""
    return bundled_ffmpeg() or shutil.which("ffmpeg")


if __name__ == "__main__":
    found = ffmpeg_exe()
    if not found:
        print(MISSING, file=sys.stderr)
        sys.exit(1)
    print(found)
