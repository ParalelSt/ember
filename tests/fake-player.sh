#!/usr/bin/env bash
# Stand-in for player.py in tests: no yt-dlp, no network.
#
# Records every command it's asked to run (one per line in $FAKE_PLAYER_LOG) so
# a test can assert HOW MANY downloads happened, and whether the server tried
# to resolve a live stream URL at all.
set -euo pipefail

CMD="${1:-}"
VIDEO_ID="${!#}"     # last arg, after the `--`
LOG="${FAKE_PLAYER_LOG:-/tmp/fake-player.log}"
echo "$CMD $VIDEO_ID" >> "$LOG"

# Per-id failure lists, re-read on every call so a test can "restore" a video
# by editing the file while the server keeps running.
listed() { [ -n "${2:-}" ] && [ -f "$2" ] && grep -qx "$1" "$2"; }
if [ "$CMD" = download ] || [ "$CMD" = info ]; then
  if listed "$VIDEO_ID" "${FAKE_UNAVAILABLE_FILE:-}"; then
    echo "ERROR: [youtube] $VIDEO_ID: Video unavailable. This video has been removed by the uploader" >&2
    exit 1
  fi
  if listed "$VIDEO_ID" "${FAKE_TRANSIENT_FILE:-}"; then
    if [ "$CMD" = download ]; then echo "ERROR: unable to download video data: HTTP Error 403: Forbidden" >&2
    else echo "ERROR: [youtube] $VIDEO_ID: Sign in to confirm you're not a bot. Use --cookies-from-browser" >&2; fi
    exit 1
  fi
fi

case "$CMD" in
  download)
    # FAKE_FAIL_DOWNLOAD=1 reproduces the real-world failure this guards
    # against: a stale yt-dlp whose downloader gets 403'd while URL resolution
    # still works fine.
    if [ "${FAKE_FAIL_DOWNLOAD:-0}" = "1" ]; then
      # Shaped like a real yt-dlp failure: a traceback through site-packages
      # wrapped around one useful ERROR line. Only that line should ever reach
      # the browser.
      {
        echo "Traceback (most recent call last):"
        echo "  File \"/opt/ember/.venv/lib/python3.13/site-packages/yt_dlp/YoutubeDL.py\", line 1103, in trouble"
        echo "    raise DownloadError(message, exc_info)"
        echo "ERROR: unable to download video data: HTTP Error 403: Forbidden"
      } >&2
      exit 1
    fi
    mkdir -p "$MUSIC_DIR"
    OUT="$MUSIC_DIR/$VIDEO_ID.m4a"
    # Reproduce yt-dlp's real behaviour: the final filename appears BEFORE the
    # file is finished (rename, then post-process). Anything serving it during
    # this window hands out a truncated file.
    if [ "${FAKE_PARTIAL_FIRST:-0}" = "1" ]; then
      printf 'PARTIAL' > "$OUT"
    fi
    # Slow enough that concurrent callers overlap — that's the race being tested.
    sleep "${FAKE_DOWNLOAD_SECONDS:-2}"
    printf 'FAKE-AUDIO-%s' "$VIDEO_ID" > "$OUT"
    printf '{"filePath": "%s"}' "$OUT"
    ;;
  info)
    # Reached in proxy mode, and by the fallback when a download fails.
    # Defaults to a dead URL so accidental proxying fails loudly rather than
    # silently "working"; FAKE_STREAM_URL points it at a real test origin.
    printf '{"url": "%s", "ext": "m4a", "httpHeaders": {}}' \
      "${FAKE_STREAM_URL:-http://127.0.0.1:9/nope}"
    ;;
  match)
    T='"artist":"Fake Artist","artworkUrl":"","durationSec":200'
    printf '{"results":[{"videoId":"bbbbbbbbbbb","title":"Replacement Song",%s}]}' "$T"
    ;;
  search)
    T='"artist":"Fake Artist","artworkUrl":"","durationSec":200'
    printf '[{"videoId":"bbbbbbbbbbb","title":"Replacement Song",%s},{"videoId":"eeeeeeeeeee","title":"Replacement Song (Live)",%s},{"videoId":"ddddddddddd","title":"Replacement Song",%s},{"videoId":"fffffffffff","title":"Other Song",%s}]' "$T" "$T" "$T" "$T"
    ;;
  recommended)
    T='"artist":"Fake Artist","artworkUrl":"","durationSec":200'
    printf '[{"videoId":"ddddddddddd","title":"Replacement Song",%s},{"videoId":"aaaaaaaaaaa","title":"Live Song",%s}]' "$T" "$T"
    ;;
  *)
    printf '{"error": "fake-player: unsupported command %s"}' "$CMD" >&2
    exit 1
    ;;
esac
