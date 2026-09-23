import { checkCaps, normaliseParams, PRANK_LIMITS, type CapReason, type RecentPrank } from './limits';
import type { PrankParams } from './types';

/** Repeating sounds (plan section 3c, sounds only since the swap was
 *  dropped): every `prank_schedules` row that is due becomes one `pranks`
 *  row, under the same caps as a sound sent by hand. Pure over `TickStore`,
 *  so the tests need no PocketBase; schedulerInstance.ts runs it every 5 s. */

export interface ScheduleRow {
  id: string;
  target: string;
  issuedBy: string;
  sound: string;
  /** As stored; normalised again before a row is written. */
  params: unknown;
  intervalSec: number;
  /** ms */
  endsAt: number;
  nextFireAt: number;
  fired: number;
}

/** A pranks row the tick writes. `status` is pending for a sound that goes
 *  out, skipped for a fire that found nothing playing. */
export interface TickPrank {
  target: string;
  issuedBy: string;
  schedule: string;
  sound: string;
  params: PrankParams;
  status: 'pending' | 'skipped';
  reason: string;
  expiresAt: number;
}

export interface SchedulePatch {
  active?: boolean;
  nextFireAt?: number;
  fired?: number;
}

export interface TickStore {
  /** The global switch (and PRANKS_ENABLED=0). */
  enabled(): Promise<boolean>;
  /** Active schedules with next_fire_at <= now. */
  due(now: number): Promise<ScheduleRow[]>;
  /** The target's rows and the issuer's rows from the last hour, read fresh
   *  each call so a row written earlier in the same tick counts. */
  recent(targetId: string, adminId: string, now: number): Promise<{ forTarget: RecentPrank[]; byAdmin: RecentPrank[] }>;
  /** A fresh heartbeat says their music is playing. */
  isPlaying(targetId: string, now: number): boolean;
  /** The sound's media URL, null when it left the library. */
  soundUrl(soundId: string): Promise<string | null>;
  createPrank(row: TickPrank): Promise<void>;
  updateSchedule(id: string, patch: SchedulePatch): Promise<void>;
  /** Writes expired onto pending rows past their window; returns how many. */
  expireStale(now: number): Promise<number>;
}

export type TickResult =
  | { id: string; result: 'fired' | 'not-playing' | 'ended' | 'switched-off' | 'sound-gone' }
  | { id: string; result: 'capped'; reason: CapReason };

/** The fire after `next`, never in the past: a schedule that missed fires
 *  (server asleep, a long cap) plays once and carries on from now. */
export function nextFire(next: number, intervalSec: number, now: number): number {
  const step = intervalSec * 1000;
  const n = next + step;
  return n > now ? n : now + step;
}

export async function runTick(now: number, store: TickStore): Promise<{ results: TickResult[]; expired: number }> {
  const expired = await store.expireStale(now);
  const due = (await store.due(now)).sort((a, b) => a.nextFireAt - b.nextFireAt);
  if (due.length === 0) return { results: [], expired };

  const results: TickResult[] = [];
  const enabled = await store.enabled();

  for (const s of due) {
    if (!enabled) {
      await store.updateSchedule(s.id, { active: false });
      results.push({ id: s.id, result: 'switched-off' });
      continue;
    }
    if (s.endsAt <= now) {
      await store.updateSchedule(s.id, { active: false });
      results.push({ id: s.id, result: 'ended' });
      continue;
    }
    const url = await store.soundUrl(s.sound);
    if (!url) {
      await store.updateSchedule(s.id, { active: false });
      results.push({ id: s.id, result: 'sound-gone' });
      continue;
    }

    const next = nextFire(s.nextFireAt, s.intervalSec, now);
    // Past the stop time the schedule is over now, not at its next fire.
    const advance = (fired: number): SchedulePatch =>
      next > s.endsAt ? { active: false, nextFireAt: next, fired } : { nextFireAt: next, fired };
    const params = { ...normaliseParams('sound', s.params), streamUrl: url };
    const row = { target: s.target, issuedBy: s.issuedBy, schedule: s.id, sound: s.sound, params };

    if (!store.isPlaying(s.target, now)) {
      // Logged for the admin, and not counted against the hourly cap.
      await store.createPrank({ ...row, status: 'skipped', reason: 'not-playing', expiresAt: now });
      await store.updateSchedule(s.id, advance(s.fired));
      results.push({ id: s.id, result: 'not-playing' });
      continue;
    }

    const { forTarget, byAdmin } = await store.recent(s.target, s.issuedBy, now);
    const cap = checkCaps('sound', forTarget, byAdmin, now);
    if (!cap.ok) {
      // Try again as soon as the cap allows (a 15 s gap is seconds away, the
      // hourly cap can be most of an hour), or not at all past the stop time.
      const retry = now + cap.retryAfterSec * 1000;
      await store.updateSchedule(s.id, retry > s.endsAt ? { active: false } : { nextFireAt: retry });
      results.push({ id: s.id, result: 'capped', reason: cap.reason });
      continue;
    }

    await store.createPrank({ ...row, status: 'pending', reason: '', expiresAt: now + PRANK_LIMITS.expirySec * 1000 });
    await store.updateSchedule(s.id, advance(s.fired + 1));
    results.push({ id: s.id, result: 'fired' });
  }
  return { results, expired };
}

export type ScheduleCheck =
  | { ok: true; intervalSec: number; endsAt: number }
  | { ok: false; error: string };

/** The rules for a new repeat: every 60 s to 2 h, until a time no more
 *  than 2 h away and at least one interval out. */
export function checkSchedule(intervalSec: unknown, endsAt: unknown, now: number): ScheduleCheck {
  const L = PRANK_LIMITS;
  const interval = typeof intervalSec === 'number' && Number.isFinite(intervalSec) ? Math.round(intervalSec) : NaN;
  if (!(interval >= L.scheduleMinIntervalSec && interval <= L.scheduleMaxSpanSec)) {
    return { ok: false, error: 'Repeat every 1 minute to 2 hours' };
  }
  const ends = typeof endsAt === 'string' ? Date.parse(endsAt) : typeof endsAt === 'number' ? endsAt : NaN;
  if (!Number.isFinite(ends) || ends <= now) return { ok: false, error: 'Pick a stop time in the future' };
  if (ends > now + L.scheduleMaxSpanSec * 1000 + 60_000) return { ok: false, error: 'A repeat can run for 2 hours at most' };
  if (ends < now + interval * 1000) return { ok: false, error: 'The stop time is sooner than the second play' };
  return { ok: true, intervalSec: interval, endsAt: ends };
}
