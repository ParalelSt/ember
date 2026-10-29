import 'server-only';
import type PocketBase from 'pocketbase';
import { createCatalogClient } from '@/lib/pocketbase/server';
import { serverLogger } from '@/lib/logger/server';
import { parsePbDate, pbDate } from './limits';
import { prankMediaUrl } from './media';
import { presenceStore } from './presence';
import { runTick, type ScheduleRow, type TickStore } from './scheduler';
import { toRecent } from './server';
import { pranksEnabled } from './settings';

const HOUR_MS = 60 * 60 * 1000;
const is404 = (e: unknown) => (e as { status?: number })?.status === 404;

/** The TickStore over the admin client. Every read passes requestKey null:
 *  the SDK would otherwise cancel one of two reads of the same collection. */
export function pbTickStore(pb: PocketBase): TickStore {
  const q = { requestKey: null };
  return {
    enabled: () => pranksEnabled(pb),
    async due(now) {
      const rows = await pb.collection('prank_schedules').getFullList({
        filter: pb.filter('active = true && next_fire_at <= {:now}', { now: pbDate(now) }),
        ...q,
      });
      return rows.map((r): ScheduleRow => ({
        id: r.id,
        target: String(r.target),
        issuedBy: String(r.issued_by ?? ''),
        sound: String(r.sound ?? ''),
        params: r.params,
        intervalSec: Number(r.interval_sec),
        endsAt: parsePbDate(r.ends_at),
        nextFireAt: parsePbDate(r.next_fire_at),
        fired: Number(r.fired ?? 0),
      }));
    },
    async recent(targetId, adminId, now) {
      const since = pbDate(now - HOUR_MS);
      const [forTarget, byAdmin] = await Promise.all([
        pb.collection('pranks').getFullList({ filter: pb.filter('target = {:t} && created >= {:since}', { t: targetId, since }), ...q }),
        pb.collection('pranks').getFullList({ filter: pb.filter('issued_by = {:a} && created >= {:since}', { a: adminId, since }), ...q }),
      ]);
      return { forTarget: forTarget.map((r) => toRecent(r, now)), byAdmin: byAdmin.map((r) => toRecent(r, now)) };
    },
    isPlaying: (targetId, now) => presenceStore().get(targetId, now)?.isPlaying === true,
    async soundUrl(soundId) {
      if (!soundId) return null;
      try {
        const row = await pb.collection('prank_sounds').getOne(soundId, q);
        return row.kind === 'sound' ? prankMediaUrl(row.id) : null;
      } catch (e) {
        if (is404(e)) return null;
        throw e;
      }
    },
    async createPrank(p) {
      const rec = await pb.collection('pranks').create({
        target: p.target,
        issued_by: p.issuedBy,
        schedule: p.schedule,
        kind: 'sound',
        sound: p.sound,
        params: p.params,
        status: p.status,
        reason: p.reason,
        expires_at: pbDate(p.expiresAt),
      });
      return rec.id;
    },
    async scheduleActive(id) {
      try {
        return (await pb.collection('prank_schedules').getOne(id, q)).active === true;
      } catch (e) {
        if (is404(e)) return false;
        throw e;
      }
    },
    async cancelPrank(id) {
      await pb.collection('pranks').update(id, { status: 'cancelled' });
    },
    async updateSchedule(id, patch) {
      const data: Record<string, unknown> = {};
      if (patch.active !== undefined) data.active = patch.active;
      if (patch.fired !== undefined) data.fired = patch.fired;
      if (patch.nextFireAt !== undefined) data.next_fire_at = pbDate(patch.nextFireAt);
      await pb.collection('prank_schedules').update(id, data);
    },
    async expireStale(now) {
      const stale = await pb.collection('pranks').getFullList({
        filter: pb.filter('status = "pending" && expires_at < {:now}', { now: pbDate(now) }),
        ...q,
      });
      for (const r of stale) await pb.collection('pranks').update(r.id, { status: 'expired' });
      return stale.length;
    },
  };
}

const KEY = Symbol.for('ember.pranks.tick');

/** Starts the repeating-sound tick once per server: every 5 s, or
 *  PRANK_TICK_INTERVAL_MS (the browser test runs it every second). A tick
 *  still running when the next is due is skipped, so two never overlap.
 *  Off entirely with PRANK_TICK_DISABLED=1; the global switch is checked
 *  inside every tick. */
export function startPrankTick(): void {
  const g = globalThis as { [KEY]?: true };
  if (g[KEY]) return;
  g[KEY] = true;

  const every = Number(process.env.PRANK_TICK_INTERVAL_MS) > 0 ? Number(process.env.PRANK_TICK_INTERVAL_MS) : 5_000;
  let running = false;
  let failing = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const now = Date.now();
      // The shared admin client, not one kept for 30 minutes: after a
      // restore that gives the superuser a new token key, PocketBase reads
      // the old token as a guest, and the tick saw no due repeats. The shared
      // one checks such answers and signs in again (guardCatalog).
      const pb = await createCatalogClient();
      // Every outcome is already a pranks row or a schedule change the admin
      // log shows; only failures go to the server log.
      await runTick(now, pbTickStore(pb));
      failing = false;
    } catch (e) {
      // PocketBase restarting, most likely. Warned once per failure streak,
      // not every 5 s.
      if (!failing) serverLogger.warn('pranks', 'repeat tick failed', undefined, e);
      failing = true;
    } finally {
      running = false;
    }
  };
  const timer = setInterval(() => void tick(), every);
  timer.unref?.();
}
