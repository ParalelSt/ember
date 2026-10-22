#!/usr/bin/env bash
#
# Every test suite a release needs, at once, with one line per suite at the
# end. Logs go to .release-logs/ so a failure can be read without running it
# again.
#
#   scripts/release/check-all.sh            # web, guards, Python
#   scripts/release/check-all.sh --shells   # also Rust (desktop) and Android
#
# Exit code 0 only when every suite passed.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# A worktree has no .venv of its own: use the main checkout's.
MAIN="$(cd "$ROOT" && cd "$(git rev-parse --git-common-dir)/.." && pwd)"
LOGS="$ROOT/.release-logs"
mkdir -p "$LOGS"
rm -f "$LOGS"/*.log

SHELLS=0
[ "${1:-}" = "--shells" ] && SHELLS=1

PY="$ROOT/.venv/bin/python"
[ -x "$PY" ] || PY="$MAIN/.venv/bin/python"

declare -a NAMES=() PIDS=()
run() {
  local name="$1"; shift
  ( cd "$ROOT" && "$@" ) >"$LOGS/$name.log" 2>&1 &
  NAMES+=("$name"); PIDS+=("$!")
}

run web       bash -c 'cd apps/web && npx vitest run'
run guards    bash -c 'node tests/no-em-dashes.test.mjs && node tests/release-scripts.test.mjs'
if [ -x "$PY" ]; then
  run python  "$PY" -m unittest discover -s tests -p 'test_*.py'
else
  echo "skip  python (no .venv found in $ROOT or $MAIN)"
fi
if [ "$SHELLS" = 1 ]; then
  run rust    bash -c 'cd apps/desktop/src-tauri && cargo test --quiet'
  run android bash -c 'cd apps/mobile/android && ./gradlew --quiet testDebugUnitTest'
fi

FAILED=0
for i in "${!PIDS[@]}"; do
  if wait "${PIDS[$i]}"; then
    printf 'pass  %s\n' "${NAMES[$i]}"
  else
    printf 'FAIL  %s  (see .release-logs/%s.log)\n' "${NAMES[$i]}" "${NAMES[$i]}"
    tail -n 15 "$LOGS/${NAMES[$i]}.log" | sed 's/^/      /'
    FAILED=1
  fi
done
exit "$FAILED"
