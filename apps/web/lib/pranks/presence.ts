import type { PresenceReport } from './types';

/** How often a playing client reports, and when a report stops counting. */
export const PRESENCE_INTERVAL_MS = 20_000;
export const PRESENCE_STALE_MS = 60_000;

export interface Presence extends PresenceReport {
  /** When the report arrived (server clock). */
  at: number;
  /** When the current track started being reported, for "since 4 min ago". */
  since: number;
}

export interface PresenceStore {
  record(userId: string, report: PresenceReport, now: number): Presence;
  /** The user's last report if it is fresh, else null. */
  get(userId: string, now: number): Presence | null;
  /** The last report even when stale (for "last seen 12 min ago"). */
  last(userId: string): Presence | null;
  clear(): void;
}

/** In-memory "what is everybody playing". No collection: it refills within
 *  one heartbeat of a restart and needs no cleanup. */
export function createPresenceStore(): PresenceStore {
  const map = new Map<string, Presence>();
  return {
    record(userId, report, now) {
      const prev = map.get(userId);
      const sameTrack = prev && prev.track?.id === report.track?.id && now - prev.at <= PRESENCE_STALE_MS;
      const entry: Presence = { ...report, at: now, since: sameTrack ? prev.since : now };
      map.set(userId, entry);
      return entry;
    },
    get(userId, now) {
      const p = map.get(userId);
      return p && now - p.at <= PRESENCE_STALE_MS ? p : null;
    },
    last(userId) {
      return map.get(userId) ?? null;
    },
    clear() {
      map.clear();
    },
  };
}

const KEY = Symbol.for('ember.pranks.presence');

/** The process-wide store, on globalThis so every route bundle shares it. */
export function presenceStore(): PresenceStore {
  const g = globalThis as { [KEY]?: PresenceStore };
  g[KEY] ??= createPresenceStore();
  return g[KEY];
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const finite = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0);

/** Validates a client's heartbeat body; null when it is not one. */
export function parsePresence(body: unknown): PresenceReport | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const t = b.track as Record<string, unknown> | null | undefined;
  let track: PresenceReport['track'] = null;
  if (t && typeof t === 'object') {
    if (typeof t.id !== 'string' || typeof t.title !== 'string') return null;
    track = { id: str(t.id, 200), title: str(t.title, 300), artist: str(t.artist, 300), durationSec: finite(t.durationSec) };
  }
  return {
    track,
    position: finite(b.position),
    isPlaying: b.isPlaying === true && track !== null,
    engine: str(b.engine, 20) || 'web',
    appVersion: str(b.appVersion, 80),
  };
}
