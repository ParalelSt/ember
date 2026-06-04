/** Defensive scrubber for log payloads before they leave the device. Strips
 *  obviously-sensitive field names and truncates long strings. Runs over an
 *  arbitrary value (object / array / primitive). Handles cycles by short-
 *  circuiting on previously-seen objects. */

export const MAX_STRING_LEN = 4096;
export const SCRUBBED_KEYS = ['password', 'token', 'cookie', 'authorization'];

const TRUNCATED_MARKER = '…[truncated]';
const SCRUBBED_MARKER = '[scrubbed]';

export function scrub(value: unknown): unknown {
  return walk(value, new WeakSet());
}

function walk(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return value.length > MAX_STRING_LEN
      ? value.slice(0, MAX_STRING_LEN) + TRUNCATED_MARKER
      : value;
  }

  if (typeof value !== 'object') return value;

  // Cycle guard.
  if (seen.has(value as object)) return '[circular]';
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => walk(item, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SCRUBBED_KEYS.includes(k.toLowerCase())) {
      out[k] = SCRUBBED_MARKER;
    } else {
      out[k] = walk(v, seen);
    }
  }
  return out;
}
