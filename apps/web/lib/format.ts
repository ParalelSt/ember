/** Small text formatters shared by the player, library and settings UI.
 *  Framework-free (no React/Next imports) so plain Node tests can import
 *  them directly. */

/** `m:ss`. Non-finite, negative or nullish input falls back to `opts.empty`
 *  (default `'0:00'`). Uses floor for both minutes and seconds, matching
 *  the majority of the call sites this replaces. */
export function formatTime(sec: number | null | undefined, opts?: { empty?: string }): string {
  const empty = opts?.empty ?? '0:00';
  // Zero counts as "no duration": every site this replaced treated it that
  // way (a track with no known length shows the placeholder, not 0:00).
  if (!sec || !Number.isFinite(sec) || sec < 0) return empty;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** `1h 12m` above an hour, else `m:ss`. Ported from the album page's
 *  `fmtTotal` exactly (including its falsy-input short circuit). */
export function formatTotalDuration(sec: number): string {
  if (!sec || !isFinite(sec)) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Ported from the downloads settings page. A size moves up a unit once
 *  it rounds to 1024 of the smaller one ("1.0 MB", not "1024 KB"). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const kb = n / 1024;
  if (Math.round(kb) < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  if (Number(mb.toFixed(1)) < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

/** `'7 songs'`, `'1 track'`. Pass `plural` for an irregular plural; defaults
 *  to `${noun}s`. */
export function formatCount(n: number, noun: string, plural?: string): string {
  return `${n} ${n === 1 ? noun : (plural ?? `${noun}s`)}`;
}

/** Ported from `FriendsListening`'s `agoLabel` exactly: minutes only, no
 *  hour/day buckets. `now` is injectable so tests are deterministic. */
export function formatAgo(iso: string, now: number = Date.now()): string {
  // PocketBase sends `2026-06-12 10:00:00.000Z`; Safari's engine reads only
  // the ISO `T` form and would answer "NaN min ago".
  const at = new Date(String(iso ?? '').replace(' ', 'T')).getTime();
  if (Number.isNaN(at)) return '';
  const mins = Math.max(0, Math.round((now - at) / 60000));
  if (mins < 1) return 'now';
  if (mins === 1) return '1 min ago';
  return `${mins} min ago`;
}

/** Like formatAgo for things seen days apart: "just now", "12 min ago",
 *  "3 h ago", "5 d ago". */
export function formatLastSeen(iso: string, now: number = Date.now()): string {
  const at = new Date(String(iso ?? '').replace(' ', 'T')).getTime();
  if (Number.isNaN(at)) return 'unknown';
  const mins = Math.max(0, Math.round((now - at) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

/** "12 Jun" for a date this year, "12 Jun 2025" before it: when a song was
 *  added to a playlist or liked. Takes PocketBase's `2026-06-12 10:00:00.000Z`
 *  as well as ISO. Empty for a missing or unreadable date. The day is the
 *  listener's own: a like at 01:30 in Zagreb is that day, not the UTC day
 *  before. Only rendered in the browser (the lists load there), so server
 *  and client never disagree on the zone. */
export function formatAddedDate(value: string | null | undefined, now: number = Date.now()): string {
  if (!value) return '';
  const d = new Date(value.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
