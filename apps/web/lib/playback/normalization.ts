'use client';

import { api } from '@/lib/api';

/** Volume normalization on the listener's side.
 *
 *  The server measures each downloaded song once (loudness.py) and hands out
 *  a gain in dB that brings it to about -14 LUFS. The player turns that into
 *  a volume multiplier (every engine's setVolume takes it as `normGain`), so
 *  switching from a loud modern master to a quiet older song does not need
 *  the volume slider. A song with no measurement plays unchanged. */

/** The same bounds loudness.py clamps to, applied again here so a bad value
 *  from anywhere can never blast or mute a song. */
export const MIN_GAIN_DB = -12;
export const MAX_GAIN_DB = 6;

/** dB to a linear amplitude multiplier; anything not a number is 1. */
export function dbToLinear(db: number | null | undefined): number {
  if (typeof db !== 'number' || !Number.isFinite(db)) return 1;
  const clamped = Math.min(MAX_GAIN_DB, Math.max(MIN_GAIN_DB, db));
  return Math.pow(10, clamped / 20);
}

/** Only YouTube songs are measured (they are the ones on the server's disk). */
const MEASURABLE_RE = /^youtube:[A-Za-z0-9_-]{11}$/;

const STORAGE_KEY = 'ember.trackGains.v1';
/** Enough for a big library; the oldest entries go first. */
const MAX_ENTRIES = 2000;

/** Measured gains, by track id. A gain never changes, so a found one is kept
 *  for good (and in localStorage, so a downloaded song played offline is
 *  still normalized). "Not measured yet" is never cached: the server may
 *  have measured it by the next time we ask. */
let gains: Map<string, number> | null = null;
const inFlight = new Map<string, Promise<number | null>>();

function store(): Map<string, number> {
  if (gains) return gains;
  gains = new Map();
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object') {
      for (const [id, g] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof g === 'number' && Number.isFinite(g)) gains.set(id, g);
      }
    }
  } catch {
    /* storage blocked or corrupt: start empty */
  }
  return gains;
}

function persist(map: Map<string, number>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(map)));
  } catch {
    /* full or blocked: the in-memory copy still works */
  }
}

/** The gain we already know for this track, or undefined. Synchronous, so a
 *  known song gets its level in the same render that loads it. */
export function cachedTrackGain(trackId: string | null | undefined): number | undefined {
  if (!trackId) return undefined;
  return store().get(trackId);
}

/** Ask the server for a track's gain. Resolves null when there is none yet
 *  (or offline, or not a YouTube song); never rejects. Concurrent asks for
 *  the same track share one request. */
export function loadTrackGain(trackId: string | null | undefined): Promise<number | null> {
  if (!trackId || !MEASURABLE_RE.test(trackId)) return Promise.resolve(null);
  const known = cachedTrackGain(trackId);
  if (known !== undefined) return Promise.resolve(known);
  const running = inFlight.get(trackId);
  if (running) return running;
  const job = api
    .getTrackGain(trackId)
    .then((r) => {
      const g = r?.gainDb;
      if (typeof g !== 'number' || !Number.isFinite(g)) return null;
      const map = store();
      map.delete(trackId);
      map.set(trackId, g);
      while (map.size > MAX_ENTRIES) map.delete(map.keys().next().value as string);
      persist(map);
      return g;
    })
    .catch(() => null)
    .finally(() => inFlight.delete(trackId));
  inFlight.set(trackId, job);
  return job;
}

/** Tests only: forget everything this module has cached. */
export function resetTrackGainsForTests(): void {
  gains = null;
  inFlight.clear();
}
