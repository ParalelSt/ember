import 'server-only';
import type PocketBase from 'pocketbase';

/** The global prank switch: `app_settings` row `key = "pranks"`, value
 *  `{ enabled }`. PRANKS_ENABLED=0 in the environment forces it off (for
 *  sandboxes). A missing row reads as on: the boot hook creates it on. */
export async function pranksEnabled(pb: PocketBase): Promise<boolean> {
  if (process.env.PRANKS_ENABLED === '0') return false;
  try {
    const row = await pb.collection('app_settings').getFirstListItem('key = "pranks"');
    const value = row.value as { enabled?: unknown } | null;
    return value?.enabled !== false;
  } catch (e) {
    if ((e as { status?: number })?.status === 404) return true;
    throw e;
  }
}

/** Flips the switch (admin client). Turning it off also cancels every
 *  pending prank and stops every schedule, so "off" means nothing more
 *  arrives anywhere. Returns how many pending rows were cancelled. */
export async function setPranksEnabled(pb: PocketBase, enabled: boolean): Promise<number> {
  let row = null;
  try {
    row = await pb.collection('app_settings').getFirstListItem('key = "pranks"');
  } catch (e) {
    if ((e as { status?: number })?.status !== 404) throw e;
  }
  const prev = (row?.value ?? {}) as Record<string, unknown>;
  if (row) await pb.collection('app_settings').update(row.id, { value: { ...prev, enabled } });
  else await pb.collection('app_settings').create({ key: 'pranks', value: { enabled } });
  if (enabled) return 0;
  return (await stopEverything(pb)).cancelled;
}

/** Stops every repeat and cancels every prank still waiting for its app.
 *  A sound already playing runs out on its own (30 s at most). */
export async function stopEverything(pb: PocketBase): Promise<{ stopped: number; cancelled: number }> {
  const schedules = await pb.collection('prank_schedules').getFullList({ filter: 'active = true', requestKey: null });
  for (const s of schedules) await pb.collection('prank_schedules').update(s.id, { active: false });
  const pending = await pb.collection('pranks').getFullList({ filter: 'status = "pending"', requestKey: null });
  for (const p of pending) await pb.collection('pranks').update(p.id, { status: 'cancelled' });
  return { stopped: schedules.length, cancelled: pending.length };
}

/** Stops one repeat and cancels its plays still waiting. Null when there
 *  is no such schedule. */
export async function stopSchedule(pb: PocketBase, id: string): Promise<{ cancelled: number } | null> {
  try {
    await pb.collection('prank_schedules').update(id, { active: false });
  } catch (e) {
    if ((e as { status?: number })?.status === 404) return null;
    throw e;
  }
  const pending = await pb.collection('pranks').getFullList({
    filter: pb.filter('schedule = {:id} && status = "pending"', { id }),
    requestKey: null,
  });
  for (const p of pending) await pb.collection('pranks').update(p.id, { status: 'cancelled' });
  return { cancelled: pending.length };
}
