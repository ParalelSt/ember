import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { rateLimitResponse } from '@/lib/rateLimit';
import { searchMatchCandidates, searchTracks } from '@/lib/sources/youtube';
import { rankCandidates } from '@/lib/import/score';
import { listUnavailableIds } from '@/lib/trackAvailability';
import { songKey } from '@/lib/songKey';
import type { Track } from '@/types/track';
import { withRequestLog } from '@/lib/logger/withRequestLog';

export const GET = withRequestLog('tracks/[id]/replacements', async (_req: NextRequest, ctx: RouteContext<'/api/tracks/[id]/replacements'>) => {
  try {
    const { pb, user } = await requireUser();
    const limited = rateLimitResponse(`replacements:${user.id}`, { windowMs: 60_000, max: 30 });
    if (limited) return limited;

    const { id } = await ctx.params;
    const row = await pb.collection('tracks').getFirstListItem(`external_id = "${esc(id)}"`);
    const title = String(row.title ?? '');
    const artist = String(row.artist ?? '');

    // Both spawn player.py; run them together so the dialog waits for the
    // slower one, not the sum.
    const [matched, searched, dead] = await Promise.all([
      searchMatchCandidates([{ title, artist }]).catch(() => [[]]),
      searchTracks(`${title} ${artist}`.trim(), { limit: 10 }).catch(() => []),
      listUnavailableIds(),
    ]);
    const want = songKey({ title, artist });
    const seen = new Set<string>([id]);
    // The best-scoring song match leads, as the old single match did.
    const best = rankCandidates(
      { title, artists: [artist] },
      (matched[0] ?? []).map((c) => ({ ...c, title: c.track.title, durationSec: c.track.durationSec })),
    )[0]?.track;
    const pool = [...(best ? [best] : []), ...searched].filter((t: Track) => {
      if (seen.has(t.id) || dead.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
    const candidates = [
      ...pool.filter((t) => songKey(t) === want),
      ...pool.filter((t) => songKey(t) !== want),
    ].slice(0, 5);
    return Response.json({ candidates });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
