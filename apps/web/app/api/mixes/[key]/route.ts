import type { NextRequest } from 'next/server';
import { listBlocked, withoutBlocked } from '@/lib/blockedTracks';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { pbQuote } from '@/lib/genres/store';
import { fromMixRecord, type MixRecord } from '@/lib/mixes/store';
import { listUnavailableIds } from '@/lib/trackAvailability';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { MIX_KEY_RE, type MixPayload } from '@/lib/mixesView';

/** One of the signed-in member's mixes with its songs, dead ones dropped
 *  at read time. Another member's mix, or one that is gone, is a 404. */
export const GET = withRequestLog('mixes/[key]', async (_request: NextRequest, ctx: { params: Promise<{ key: string }> }) => {
  try {
    const { pb, user } = await requireUser();
    const { key } = await ctx.params;
    if (!MIX_KEY_RE.test(key)) return jsonError('Mix not found', 404);
    const record = await pb.collection('mixes')
      .getFirstListItem<MixRecord>(`user = ${pbQuote(user.id)} && key = ${pbQuote(key)}`)
      .catch((e: { status?: number }) => {
        if (e?.status === 404 || e?.status === 403) return null;
        throw e;
      });
    if (!record) return jsonError('Mix not found', 404);
    const mix = fromMixRecord(record);
    const [dead, blocked] = await Promise.all([listUnavailableIds(), listBlocked(pb, user.id)]);
    const body: MixPayload = {
      key: mix.key, title: mix.title, subtitle: mix.subtitle, cover: mix.cover, builtAt: mix.builtAt,
      // Never a song this person blocked.
      tracks: withoutBlocked(mix.tracks.filter((t) => !dead.has(t.id)), blocked),
    };
    return Response.json(body);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
