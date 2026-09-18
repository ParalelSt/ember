import type { LogEntry, ServerLogEntry } from '../logger/types';

/** Groups log entries that are "the same bug" even when the exact ids,
 *  counts or timestamps embedded in the message differ from one occurrence
 *  to the next (a 502 for one video is the same bug as a 502 for another).
 *
 *  Strips, in order: query strings off URLs (before quoting/number rules
 *  would mangle them), quoted strings, PocketBase-style 15-char ids and
 *  youtube:<id> ids, long hex/base64 blobs, then any remaining digit runs.
 *  Order matters: an id must be swallowed whole before the number rule
 *  chews a hole in the middle of it. */
export function normalizeMessage(message: string): string {
  let s = message;

  // youtube:<id>: keep the "youtube:" tag (it's meaningful), drop the id.
  s = s.replace(/youtube:[A-Za-z0-9_-]{6,}/g, 'youtube:#');

  // URL query strings: keep the path (it identifies the endpoint), drop the
  // params (they're usually the varying part: tokens, ids, cache-busters).
  s = s.replace(/(https?:\/\/[^\s"'?]+)\?[^\s"']*/g, '$1');

  // Quoted strings (single or double): free-form, never stable.
  s = s.replace(/"[^"]*"/g, '#');
  s = s.replace(/'[^']*'/g, '#');

  // PocketBase record ids: exactly 15 lowercase-alphanumeric characters.
  s = s.replace(/\b[a-z0-9]{15}\b/gi, '#');

  // Long hex or base64-ish blobs (hashes, tokens, session ids).
  s = s.replace(/\b[a-fA-F0-9]{16,}\b/g, '#');
  s = s.replace(/\b[A-Za-z0-9+/]{20,}={0,2}\b/g, '#');

  // Any digits left (counts, ports, partial ids embedded in a word).
  s = s.replace(/\d+/g, '#');

  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** FNV-1a 32-bit, hex-encoded. Deterministic across runs/processes: no
 *  Math.random, no environment-dependent hashing (unlike Node's built-in
 *  string hashing, which isn't guaranteed stable across versions). */
function hash8(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function sideOf(entry: LogEntry | ServerLogEntry): string {
  return 'side' in entry && entry.side ? entry.side : 'client';
}

function routeOf(entry: LogEntry | ServerLogEntry): string {
  return 'route' in entry && entry.route ? entry.route : '';
}

/** Short, stable id for "what kind of error is this", independent of which
 *  specific request/track/user triggered it. Same side + category + route +
 *  normalized message always yields the same fingerprint. */
export function fingerprint(entry: LogEntry | ServerLogEntry): string {
  const key = [sideOf(entry), entry.category, routeOf(entry), normalizeMessage(entry.message)].join('|');
  return hash8(key);
}
