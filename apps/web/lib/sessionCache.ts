import { createHash } from 'node:crypto';
import type { RecordModel } from 'pocketbase';

/** The session check shared by proxy.ts and lib/auth.ts
 *  (docs/android-performance.md, section 9).
 *
 *  PocketBase signs its tokens with a key only it holds, so this server
 *  cannot check a signature itself. What it can do is remember PocketBase's
 *  answer: a token PocketBase accepted is accepted again from memory for up
 *  to SESSION_CACHE_TTL_MS (never past the token's own expiry), keyed by a
 *  SHA-256 of the token, so the token itself is never kept or logged.
 *
 *  Before, the proxy refreshed the session (a new token) on every request
 *  and the route checked it again, so no remembered answer ever matched:
 *  about two PocketBase round trips per API call.
 *
 *  Security window: a session ended at PocketBase (password change, "sign
 *  out everywhere", a deleted account) can keep working from memory for up
 *  to SESSION_CACHE_TTL_MS. The app's own routes that end sessions call
 *  forgetUser, which ends that at once on this server; only a change made
 *  outside the app (PocketBase's admin UI) waits for the window. A tampered
 *  token never matches a remembered one (different hash), and an expired
 *  one is refused before any lookup. Admin-only routes ask PocketBase every
 *  time (lib/auth requireAdmin).
 *
 *  Kept on globalThis so the proxy's bundle and the routes' bundles share
 *  one memory. */

/** How long PocketBase's answer about a token is reused. */
export const SESSION_CACHE_TTL_MS = 60_000;
/** Tokens remembered at once; the least recently used goes first. */
export const SESSION_CACHE_MAX = 2_000;
/** How long holdSessions keeps answers about a member out of memory: time
 *  for PocketBase to apply a change that passed the proxy on its way. */
export const SESSION_HOLD_MS = 10_000;
/** Members whose forget is tracked at once (forgotAt, heldUntil). */
const TRACKED_MAX = 5_000;
/** The browser gets a fresh token once its own is older than this. */
export const ROTATE_AFTER_MS = 60 * 60_000;

interface Entry {
  userId: string;
  record: RecordModel;
  expires: number;
}

interface State {
  entries: Map<string, Entry>;
  inFlight: Map<string, Promise<Verified>>;
  /** Counts forgets, so an answer PocketBase gave while one happened is
   *  not kept (verifySession). */
  seq: number;
  /** The seq of the last forgetAllSessions. */
  allForgotAt: number;
  /** The seq of each member's last forget. */
  forgotAt: Map<string, number>;
  /** Until when nothing is kept about a member (holdSessions). */
  heldUntil: Map<string, number>;
  /** Until when nothing is kept about anyone. */
  allHeldUntil: number;
}

export interface Verified {
  record: RecordModel;
  /** The new token PocketBase handed out while checking. */
  token: string;
}

const KEY = Symbol.for('ember.sessionCache');
const state = ((globalThis as Record<symbol, unknown>)[KEY] ??= {
  entries: new Map(),
  inFlight: new Map(),
  seq: 0,
  allForgotAt: 0,
  forgotAt: new Map(),
  heldUntil: new Map(),
  allHeldUntil: 0,
}) as State;

function keyOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The token's expiry in ms since the epoch, read from its payload
 *  (unverified: only ever used to refuse or to shorten), or null when it is
 *  not a readable JWT. */
export function tokenExpiry(token: string): number | null {
  if (typeof token !== 'string') return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const exp = (JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as { exp?: unknown }).exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** PocketBase's remembered answer for this token, or null. */
export function cachedSession(token: string, now = Date.now()): RecordModel | null {
  if (!token) return null;
  const exp = tokenExpiry(token);
  if (exp === null || exp <= now) return null;
  const key = keyOf(token);
  const hit = state.entries.get(key);
  if (!hit) return null;
  state.entries.delete(key);
  if (hit.expires <= now) return null;
  state.entries.set(key, hit); // most recently used last
  return hit.record;
}

/** Remember that PocketBase accepted `token` for `record`. A token whose
 *  expiry cannot be read is not remembered. */
export function rememberSession(token: string, record: RecordModel, now = Date.now()): void {
  const exp = tokenExpiry(token);
  if (!token || exp === null || exp <= now || !record?.id) return;
  if (held(record.id, now)) return;
  const key = keyOf(token);
  state.entries.delete(key);
  state.entries.set(key, { userId: record.id, record, expires: Math.min(now + SESSION_CACHE_TTL_MS, exp) });
  while (state.entries.size > SESSION_CACHE_MAX) {
    const oldest = state.entries.keys().next().value;
    if (oldest === undefined) break;
    state.entries.delete(oldest);
  }
}

function held(userId: string, now: number): boolean {
  if (state.allHeldUntil > now) return true;
  const until = state.heldUntil.get(userId);
  if (until === undefined) return false;
  if (until > now) return true;
  state.heldUntil.delete(userId);
  return false;
}

/** Keep a small map from growing without end: drop its oldest entries. */
function trim<V>(map: Map<string, V>): void {
  while (map.size > TRACKED_MAX) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

/** Forget every remembered session of a person: their sessions just ended
 *  or changed at PocketBase. An answer about them PocketBase is giving right
 *  now is not kept either, and checks already under way are not joined. */
export function forgetUser(userId: string): void {
  for (const [key, entry] of state.entries) if (entry.userId === userId) state.entries.delete(key);
  state.forgotAt.delete(userId);
  state.forgotAt.set(userId, ++state.seq);
  trim(state.forgotAt);
  state.inFlight.clear();
}

/** Forget every remembered session (a password reset by link: whose it is
 *  is not known here). */
export function forgetAllSessions(): void {
  state.entries.clear();
  state.allForgotAt = ++state.seq;
  state.forgotAt.clear();
  state.inFlight.clear();
}

/** A change to a member's account ('all': to someone's, by reset link) is
 *  on its way to PocketBase: forget them, and keep nothing about them for
 *  SESSION_HOLD_MS, so a request with their old token that PocketBase
 *  answers before the change lands is not remembered. */
export function holdSessions(target: string | 'all', now = Date.now()): void {
  if (target === 'all') {
    state.allHeldUntil = now + SESSION_HOLD_MS;
    forgetAllSessions();
    return;
  }
  state.heldUntil.delete(target);
  state.heldUntil.set(target, now + SESSION_HOLD_MS);
  trim(state.heldUntil);
  forgetUser(target);
}

export function sessionCacheSize(): number {
  return state.entries.size;
}

/** Ask PocketBase about `token` (with `refresh`, its auth-refresh), once
 *  for everyone asking about the same token at the same moment, and
 *  remember the answer for the old token and the new one. Throws what
 *  `refresh` throws. */
export function verifySession(token: string, refresh: () => Promise<Verified>, now = () => Date.now()): Promise<Verified> {
  const key = keyOf(token);
  const pending = state.inFlight.get(key);
  if (pending) return pending;
  const startedAt = state.seq;
  const job = refresh()
    .then((res) => {
      // A forget while PocketBase answered: the answer may predate it.
      const forgotten = state.allForgotAt > startedAt || (state.forgotAt.get(res.record?.id) ?? 0) > startedAt;
      if (!forgotten) {
        rememberSession(token, res.record, now());
        rememberSession(res.token, res.record, now());
      }
      return res;
    })
    .finally(() => {
      if (state.inFlight.get(key) === job) state.inFlight.delete(key);
    });
  state.inFlight.set(key, job);
  return job;
}

/** Whether to hand the browser the new token: only once its own is older
 *  than ROTATE_AFTER_MS (its lifetime, the new token's, less what it has
 *  left), so the cookie and its remembered answer stay the same for an
 *  hour of use while the session still runs for the full lifetime from the
 *  last visit, as before. A token whose expiry cannot be read is replaced. */
export function shouldRotate(oldToken: string, newToken: string, now = Date.now()): boolean {
  const oldExp = tokenExpiry(oldToken);
  const newExp = tokenExpiry(newToken);
  if (oldExp === null || newExp === null) return true;
  return newExp - oldExp > ROTATE_AFTER_MS;
}

/** Tests only. */
export function _resetSessionCache(): void {
  state.entries.clear();
  state.inFlight.clear();
  state.seq = 0;
  state.allForgotAt = 0;
  state.forgotAt.clear();
  state.heldUntil.clear();
  state.allHeldUntil = 0;
}
