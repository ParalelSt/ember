import { listBlocked, withoutBlocked } from '@/lib/blockedTracks';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { pbQuote } from '@/lib/genres/store';
import { fromMixRecord, type MixRecord } from '@/lib/mixes/store';
import { listUnavailableIds } from '@/lib/trackAvailability';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import type { MixesPayload } from '@/lib/mixesView';

/** The signed-in member's genre mixes, as tiles (no track lists), Home
 *  order. Read through the member's own client, so the collection's rules
 *  keep it to their rows. Missing or old mixes start a background build
 *  for them (lib/mixes/job.ts requestBuild); the answer is what is stored
 *  meanwhile. MIXES_DISABLED=1 turns every build off. */
export const GET = withRequestLog('mixes', async () => {
  try {
    const { pb, user } = await requireUser();
    const [records, dead, blocked] = await Promise.all([
      pb.collection('mixes').getFullList<MixRecord>({ filter: `user = ${pbQuote(user.id)}`, sort: 'position' }),
      listUnavailableIds(),
      listBlocked(pb, user.id),
    ]);
    const mixes = records.map(fromMixRecord);
    let building = false;
    let lastEligible: boolean | null = null;
    if (process.env.MIXES_DISABLED !== '1') {
      const { mixJob } = await import('@/lib/mixes/instance');
      const job = mixJob();
      building = job.requestBuild(user.id, mixes);
      lastEligible = job.lastResult(user.id)?.eligible ?? null;
    }
    const body: MixesPayload = {
      eligible: mixes.length > 0 || (lastEligible ?? building),
      building,
      mixes: mixes.map((m) => ({
        key: m.key, title: m.title, subtitle: m.subtitle, cover: m.cover, builtAt: m.builtAt,
        count: withoutBlocked(m.tracks.filter((t) => !dead.has(t.id)), blocked).length,
      })),
    };
    return Response.json(body);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
