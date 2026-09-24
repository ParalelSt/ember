import type { NextRequest } from 'next/server';
import type PocketBase from 'pocketbase';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { rateLimitResponse } from '@/lib/rateLimit';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { personName } from '@/lib/pranks/copy';
import { normaliseParams, pbDate, PRANK_LIMITS } from '@/lib/pranks/limits';
import { checkSchedule } from '@/lib/pranks/scheduler';
import { pranksEnabled } from '@/lib/pranks/settings';
import { prankErrorResponse, toSchedule } from '@/lib/pranks/server';

const is404 = (e: unknown) => (e as { status?: number })?.status === 404;

async function lookups(pb: PocketBase) {
  const [users, sounds] = await Promise.all([
    pb.collection('users').getFullList({ fields: 'id,name,email', requestKey: null }),
    pb.collection('prank_sounds').getFullList({ fields: 'id,name', requestKey: null }),
  ]);
  return {
    names: new Map(users.map((u) => [u.id, personName(u)])),
    soundNames: new Map(sounds.map((s) => [s.id, String(s.name ?? '')])),
  };
}

/** Starts a repeat: one library sound for one person, every 60 s to 2 h,
 *  until a stop time at most 2 h away. The first play goes out on the next
 *  tick; the tick (lib/pranks/scheduler.ts) applies the usual caps. At most
 *  3 running per person. */
export const POST = withRequestLog('admin/pranks/schedules', async (req: NextRequest) => {
  try {
    const { user } = await requireAdmin();
    const limited = rateLimitResponse(`prank-schedule:${user.id}`, { windowMs: 60_000, max: 20 });
    if (limited) return limited;

    const body = (await req.json().catch(() => null)) as
      | { targetId?: unknown; soundId?: unknown; intervalSec?: unknown; endsAt?: unknown; params?: unknown }
      | null;
    const targetId = typeof body?.targetId === 'string' ? body.targetId : '';
    const soundId = typeof body?.soundId === 'string' ? body.soundId : '';
    if (!targetId || !soundId) return Response.json({ error: 'Pick a person and a sound' }, { status: 400 });
    const now = Date.now();
    const rule = checkSchedule(body?.intervalSec, body?.endsAt, now);
    if (!rule.ok) return Response.json({ error: rule.error }, { status: 400 });

    const pb = await createAdminClient();
    if (!(await pranksEnabled(pb))) return Response.json({ error: 'Pranks are switched off' }, { status: 409 });

    let target;
    try {
      target = await pb.collection('users').getOne(targetId);
    } catch (e) {
      if (is404(e)) return Response.json({ error: 'No such person' }, { status: 404 });
      throw e;
    }
    const sound = await pb.collection('prank_sounds').getOne(soundId).catch((e) => {
      if (is404(e)) return null;
      throw e;
    });
    if (!sound || sound.kind !== 'sound') return Response.json({ error: 'No such sound' }, { status: 404 });

    const running = await pb.collection('prank_schedules').getFullList({
      filter: pb.filter('target = {:t} && active = true', { t: targetId }),
    });
    if (running.length >= PRANK_LIMITS.maxActiveSchedulesPerTarget) {
      return Response.json(
        { error: `${personName(target)} already has ${PRANK_LIMITS.maxActiveSchedulesPerTarget} repeats running; stop one first` },
        { status: 409 },
      );
    }

    const row = await pb.collection('prank_schedules').create({
      target: targetId,
      issued_by: user.id,
      kind: 'sound',
      sound: sound.id,
      params: normaliseParams('sound', body?.params),
      interval_sec: rule.intervalSec,
      ends_at: pbDate(rule.endsAt),
      next_fire_at: pbDate(now),
      active: true,
      fired: 0,
    });
    const names = new Map([[targetId, personName(target)]]);
    const soundNames = new Map([[sound.id, String(sound.name ?? '')]]);
    return Response.json({ schedule: toSchedule(row, names, soundNames) }, { status: 201 });
  } catch (e) {
    return prankErrorResponse(e);
  }
});

/** The repeats still running, soonest stop first. */
export const GET = withRequestLog('admin/pranks/schedules', async () => {
  try {
    const { user } = await requireAdmin();
    const limited = rateLimitResponse(`prank-schedules:${user.id}`, { windowMs: 60_000, max: 120 });
    if (limited) return limited;
    const pb = await createAdminClient();
    const [rows, { names, soundNames }] = await Promise.all([
      pb.collection('prank_schedules').getFullList({ filter: 'active = true', sort: 'ends_at', requestKey: null }),
      lookups(pb),
    ]);
    return Response.json({ schedules: rows.map((r) => toSchedule(r, names, soundNames)) });
  } catch (e) {
    return prankErrorResponse(e);
  }
});
