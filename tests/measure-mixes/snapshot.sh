#!/usr/bin/env bash
# Copies a PocketBase data.db (read only, safe on a running PocketBase) and
# exports what the mix job reads as plain JSON, for the mix measurement
# (tests/measure-mixes/README.md).
#
#   snapshot.sh <pb_data dir | data.db> <out dir> [charts.json] [--yes-live]
#
# Never starts PocketBase, never writes to the source. Refuses an out dir
# inside a source pb_data dir, and the main checkout's live pb_data unless
# --yes-live is given.
set -euo pipefail

live=0
args=()
for a in "$@"; do
  if [ "$a" = "--yes-live" ]; then live=1; else args+=("$a"); fi
done
if [ "${#args[@]}" -lt 2 ]; then
  echo "usage: snapshot.sh <pb_data dir | data.db> <out dir> [charts.json] [--yes-live]" >&2
  exit 2
fi
src="${args[0]}"
out="${args[1]}"
charts="${args[2]:-}"

if [ -d "$src" ]; then db="$src/data.db"; else db="$src"; fi
[ -f "$db" ] || { echo "no data.db at $db" >&2; exit 2; }
pbdir="$(cd "$(dirname "$db")" && pwd -P)"
case "$pbdir" in
  */spotify-clone/pocketbase/pb_data)
    if [ "$live" != 1 ]; then echo "refusing the live pb_data ($pbdir) without --yes-live" >&2; exit 3; fi ;;
esac
mkdir -p "$out"
outabs="$(cd "$out" && pwd -P)"
if [ "$(basename "$pbdir")" = "pb_data" ]; then
  case "$outabs/" in
    "$pbdir"/*) echo "refusing an out dir inside $pbdir" >&2; exit 3 ;;
  esac
fi
[ "$outabs/data.db" != "$pbdir/$(basename "$db")" ] || { echo "refusing to overwrite the source" >&2; exit 3; }

started=$(date +%s)
copy="$outabs/data.db"
rm -f "$copy"
sqlite3 -readonly "$db" ".backup '$copy'"
if [ -n "$charts" ] && ! [ "$charts" -ef "$outabs/charts.json" ]; then cp "$charts" "$outabs/charts.json"; fi

q() { sqlite3 -json "$copy" "$1" > "$outabs/$2"; [ -s "$outabs/$2" ] || echo "[]" > "$outabs/$2"; }
TRACK="t.external_id, t.source, t.source_id, t.title, t.artist, t.artist_id, t.album, t.album_id, t.duration_sec, t.artwork_url, t.stream_url, t.unavailable_at, t.unavailable_reason"
q "select p.user, p.played_at, $TRACK from plays p join tracks t on t.id = p.track order by p.played_at desc" plays.json
q "select l.user, $TRACK from likes l join tracks t on t.id = l.track" likes.json
q "select b.user, $TRACK from blocked_tracks b join tracks t on t.id = b.track" blocked.json
q "select artist_key, artist_id, name, family, families, sub, tags, source, status, fetched_at from artist_genres" artist_genres.json
q "select id, user, key, title, position, tracks, seeds, built_at from mixes order by user, position" mixes.json
q "select external_id from tracks where unavailable_at != ''" unavailable.json
q "select id from users" members.json
now=$(sqlite3 "$copy" "select max(played_at) from plays")
took=$(( $(date +%s) - started ))
printf '{"now":"%s","source":"%s","seconds":%s}\n' "$now" "$db" "$took" > "$outabs/meta.json"
echo "snapshot in $outabs (now = $now)"
