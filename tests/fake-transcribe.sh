#!/usr/bin/env bash
# Stand-in for transcribe.py in the sandbox: no Python ML deps, no minutes of
# CPU. Writes a small real alphaTex after a short delay so a test can observe
# the "running" state, then the finished one.
#
#   FAKE_TRANSCRIBE_SECONDS  delay before writing (default 2)
#   FAKE_TRANSCRIBE_FAIL=1   exit 1 with a one-line reason instead
#   FAKE_TRANSCRIBE_LOG      append "<audio> <out>" per call, so a test can
#                            count how many jobs actually ran
set -euo pipefail
AUDIO="$1"; OUT="$2"
echo "$AUDIO $OUT" >> "${FAKE_TRANSCRIBE_LOG:-/tmp/fake-transcribe.log}"
sleep "${FAKE_TRANSCRIBE_SECONDS:-2}"
if [ "${FAKE_TRANSCRIBE_FAIL:-0}" = "1" ]; then
  echo "the recording is too quiet to transcribe" >&2
  exit 1
fi
mkdir -p "$(dirname "$OUT")"
cat > "$OUT.partial" <<'EOF'
\title "Fake Generated Tab"
\tempo 120
.
\tempo 120 0.6.4 0.5.4 0.4.4 0.3.4 |
\tempo 120 2.4.8 2.4.8 0.3.4 r.2 |
\tempo 120 (0.6 2.5 2.4).2 r.2 |
\tempo 120 3.6.4 3.6.4 3.6.4 3.6.4 |
EOF
mv "$OUT.partial" "$OUT"
echo '{"notes": 12, "bars": 4, "tempo": 120}'
