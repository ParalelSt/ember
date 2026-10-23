import { redactSecrets } from '@/lib/import/redact';
import type { LogEntry, ServerLogEntry } from './types';

/** Defensive scrubber for log payloads before they leave the device. Strips
 *  obviously-sensitive field names and truncates long strings. Runs over an
 *  arbitrary value (object / array / primitive). Handles cycles by short-
 *  circuiting on previously-seen objects. */

export const MAX_STRING_LEN = 4096;
export const SCRUBBED_KEYS = [
  'password',
  'token',
  'cookie',
  'authorization',
  // Google sign-in (lib/import/google/), in both spellings. Lower case:
  // keys are compared lowered.
  'access_token',
  'refresh_token',
  'id_token',
  'device_code',
  'client_secret',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'devicecode',
  'clientsecret',
];

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
      // Google credentials first (lib/import/redact.ts): a transfer from
      // YouTube Music signs in with Google, and a token, device code or
      // session cookie the generic rules below do not know must not survive
      // into a bug report.
      let out = redactSecrets(line, SCRUBBED_MARKER);
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

/** Unlike the client snapshot (already run through `scrub` on the device),
 *  server log entries travel straight from disk: scrub one before it is
 *  attached to Discord, handed to a model, or rendered into a digest.
 *  `userId` is left alone: it is a PocketBase id the host already owns, not
 *  a secret (see SETUP.md). Shared by the bug-report route and the daily
 *  digest so both redact the same way. */
export function scrubServerEntry(e: ServerLogEntry): ServerLogEntry {
  return {
    ...e,
    message: scrubText(e.message),
    stack: e.stack ? scrubText(e.stack) : e.stack,
    data: scrubData(e.data),
  };
}

/** A bug report's client entries, as the route received them. The device
 *  only ran `scrub` over them (secret-named keys), never the patterns, so a
 *  raw error message (a URL with its query, a token in a message) would go
 *  to Discord and the triage model as it was. The same pass as the server's
 *  own entries; anything that is not an entry object is dropped. */
export function scrubClientEntries(entries: unknown[]): LogEntry[] {
  const out: LogEntry[] = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object' || Array.isArray(e)) continue;
    const entry = e as LogEntry;
    const scrubbed: LogEntry = { ...entry, message: typeof entry.message === 'string' ? scrubText(entry.message) : '' };
    if ('stack' in entry) scrubbed.stack = typeof entry.stack === 'string' ? scrubText(entry.stack) : undefined;
    if ('data' in entry) scrubbed.data = scrubData(entry.data);
    out.push(scrubbed);
  }
  return out;
}

function scrubData(data: unknown): unknown {
  if (data === undefined || data === null) return data;
  try {
    // Scrubbed leaf by leaf: run over the whole JSON text, a query value's
    // pattern swallowed the closing quote and the object would not re-parse.
    return scrubDataLeaves(JSON.parse(JSON.stringify(data)));
  } catch {
    return scrubText(String(data));
  }
}

/** Header names redactSecrets drops by name in text, which a leaf alone no
 *  longer shows next to its value. */
const SERVER_SCRUBBED_KEYS = [...SCRUBBED_KEYS, 'set-cookie', 'proxy-authorization', 'x-goog-authuser', 'x-goog-visitor-id', 'x-goog-pageid'];

/** `scrubText` on every string (keys too) of parsed JSON; a secret-named key
 *  loses its whole value. */
function scrubDataLeaves(value: unknown): unknown {
  if (typeof value === 'string') return scrubText(value);
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(scrubDataLeaves);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[scrubText(k)] = SERVER_SCRUBBED_KEYS.includes(k.toLowerCase()) ? SCRUBBED_MARKER : scrubDataLeaves(v);
  }
  return out;
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
