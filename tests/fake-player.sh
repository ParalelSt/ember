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

case "$CMD" in
  download)
    mkdir -p "$MUSIC_DIR"
    OUT="$MUSIC_DIR/$VIDEO_ID.m4a"
    # Slow enough that concurrent callers overlap — that's the race being tested.
    sleep "${FAKE_DOWNLOAD_SECONDS:-2}"
    printf 'FAKE-AUDIO-%s' "$VIDEO_ID" > "$OUT"
    printf '{"filePath": "%s"}' "$OUT"
    ;;
  info)
    # Only reached in proxy mode. Points at a URL that does not exist, so any
    # accidental proxying fails loudly instead of silently "working".
    printf '{"url": "http://127.0.0.1:9/nope", "ext": "m4a", "httpHeaders": {}}'
    ;;
  *)
    printf '{"error": "fake-player: unsupported command %s"}' "$CMD" >&2
    exit 1
    ;;
esac
