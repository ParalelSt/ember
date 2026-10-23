/** PocketBase's own date format ("2026-09-23 12:00:00.000Z"), which its
 *  filters compare as text. */
export function pbDate(ms: number): string {
  return new Date(ms).toISOString().replace('T', ' ');
}

/** A PocketBase date (space or T separated) as ms; NaN when empty or not a
 *  string. */
export function parsePbDate(value: unknown): number {
  if (typeof value !== 'string' || !value) return NaN;
  return Date.parse(value.replace(' ', 'T'));
}

/** A PocketBase date as the browser's local date (or date and time), for
 *  display; '' when it cannot be read. `new Date()` on the space form is
 *  not guaranteed by the spec (older Safari answers Invalid Date). */
export function pbDateLabel(value: unknown, withTime = false): string {
  const ms = parsePbDate(value);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return withTime ? d.toLocaleString() : d.toLocaleDateString();
}
