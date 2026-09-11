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

// scrubText patterns: same categories as SCRUBBED_KEYS above, but matched by
// shape (there's no field name to key off in free text like a desktop log
// tail or a server log window). Order matters a little: bearer/cookie/pb_auth
// are checked before the generic hex/base64 blob match so a token that also
// happens to look hex-ish still gets its specific marker first (cosmetic
// only, both end up scrubbed either way).
const BEARER_RE = /\bbearer\s+[A-Za-z0-9\-_.]{8,}/gi;
const COOKIE_HEADER_RE = /\b(cookie|set-cookie)\s*:\s*\S[^\n\r]*/gi;
const PB_AUTH_RE = /\bpb_auth=[^;\s]+/gi;
// Query strings can carry search terms and other user-entered text; drop the
// value, keep the key, so "?q=..." reads as "?q=[scrubbed]" not silence.
const QUERY_VALUE_RE = /([?&][^\s?&]*?[A-Za-z0-9_]+=)[^\s&]+/g;
const LONG_HEX_RE = /\b[0-9a-f]{32,}\b/gi;
const LONG_BASE64_RE = /\b(?=[A-Za-z0-9+/]{40,}(?:=|\b))[A-Za-z0-9+/]{40,}={0,2}\b/g;

/** Line-by-line scrubber for raw text logs (the desktop shell's tail, the
 *  server log window) that never pass through `scrub`'s object walk. Applies
 *  the same secret categories by pattern instead of by field name. */
export function scrubText(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      let out = line;
      out = out.replace(BEARER_RE, `bearer ${SCRUBBED_MARKER}`);
      out = out.replace(COOKIE_HEADER_RE, (m, name) => `${name}: ${SCRUBBED_MARKER}`);
      out = out.replace(PB_AUTH_RE, `pb_auth=${SCRUBBED_MARKER}`);
      out = out.replace(QUERY_VALUE_RE, `$1${SCRUBBED_MARKER}`);
      out = out.replace(LONG_HEX_RE, SCRUBBED_MARKER);
      out = out.replace(LONG_BASE64_RE, SCRUBBED_MARKER);
      return out;
    })
    .join('\n');
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
