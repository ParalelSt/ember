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

/** Ported from the downloads settings page exactly. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** `'7 songs'`, `'1 track'`. Pass `plural` for an irregular plural; defaults
 *  to `${noun}s`. */
export function formatCount(n: number, noun: string, plural?: string): string {
  return `${n} ${n === 1 ? noun : (plural ?? `${noun}s`)}`;
}

/** Ported from `FriendsListening`'s `agoLabel` exactly: minutes only, no
 *  hour/day buckets. `now` is injectable so tests are deterministic. */
export function formatAgo(iso: string, now: number = Date.now()): string {
  const mins = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (mins < 1) return 'now';
  if (mins === 1) return '1 min ago';
  return `${mins} min ago`;
}
