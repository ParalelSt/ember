/** Backoff for the sounds client calls (inbox poll, presence heartbeat): a
 *  failed call, above all a 429, must never be followed at once by another.
 *  The server's Retry-After wins when it sends one; otherwise the wait
 *  doubles from 5 s up to a cap of 60 s. A success resets it. */
export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_MAX_MS = 60_000;

export interface Backoff {
  /** True while a call must not be made. */
  blocked(now?: number): boolean;
  /** Ms left to wait (0 when clear). */
  remaining(now?: number): number;
  fail(retryAfterMs?: number | null, now?: number): void;
  ok(): void;
}

export function createBackoff(): Backoff {
  let failures = 0;
  let until = 0;
  const remaining = (now = Date.now()) => Math.max(0, until - now);
  return {
    blocked: (now) => remaining(now) > 0,
    remaining,
    fail(retryAfterMs, now = Date.now()) {
      failures += 1;
      const own = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (failures - 1));
      const wait = retryAfterMs && retryAfterMs > 0 ? Math.min(retryAfterMs, 10 * 60_000) : own;
      until = now + Math.max(wait, BACKOFF_BASE_MS);
    },
    ok() {
      failures = 0;
      until = 0;
    },
  };
}

/** Retry-After in ms from a failed call's error (set by the api layer). */
export function retryAfterOf(e: unknown): number | null {
  const v = (e as { retryAfterMs?: unknown } | null)?.retryAfterMs;
  return typeof v === 'number' && v > 0 ? v : null;
}

/** One owner per kind per tab: a second mounted copy stays idle. */
const owners = new Map<string, symbol>();
export function claimSingleton(kind: string, owner: symbol): boolean {
  const cur = owners.get(kind);
  if (cur && cur !== owner) return false;
  owners.set(kind, owner);
  return true;
}
export function releaseSingleton(kind: string, owner: symbol): void {
  if (owners.get(kind) === owner) owners.delete(kind);
}
