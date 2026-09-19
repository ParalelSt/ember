import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { rateLimitResponse } from '@/lib/rateLimit';
import { matchItems } from '@/lib/import/match';
import type { SourceItem } from '@/lib/import/types';
import { withRequestLog } from '@/lib/logger/withRequestLog';

const MAX_BATCH = 8;

interface RawItem {
  position?: unknown;
  title?: unknown;
  artist?: unknown;
  artists?: unknown;
  durationMs?: unknown;
  explicit?: unknown;
  uri?: unknown;
}

const text = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');

function clean(i: RawItem, index: number): SourceItem {
  const artists = Array.isArray(i.artists)
    ? i.artists.filter((a): a is string => typeof a === 'string').slice(0, 10).map((a) => a.slice(0, 200))
    : [];
  const artist = text(i.artist) || artists.join(', ');
  return {
    position: typeof i.position === 'number' && Number.isInteger(i.position) ? i.position : index,
    title: text(i.title),
    artist,
    artists: artists.length ? artists : artist ? [artist] : [],
    durationMs: typeof i.durationMs === 'number' && i.durationMs > 0 ? i.durationMs : null,
    explicit: typeof i.explicit === 'boolean' ? i.explicit : null,
    uri: text(i.uri) || null,
  };
}

/** Match a small batch of source tracks onto YT Music. Each result carries
 *  the source item, a status (accepted, review, missing) and every scored
 *  candidate. The import dialog loops these so a long playlist never hits
 *  one long request. */
export const POST = withRequestLog('import/match', async (request: NextRequest) => {
  try {
    const { user } = await requireUser();
    // Generous backstop: above any real single import's sequential pace, but
    // stops someone scripting this endpoint directly.
    const limited = rateLimitResponse(`import-match:${user.id}`, { windowMs: 60_000, max: 120 });
    if (limited) return limited;

    const body = (await request.json().catch(() => null)) as { items?: RawItem[] } | null;
    const items = Array.isArray(body?.items) ? body.items : null;
    if (!items?.length) return jsonError('items required', 400);
    if (items.length > MAX_BATCH) return jsonError(`max ${MAX_BATCH} items per call`, 400);
    const results = await matchItems(items.map((i, n) => clean(i ?? {}, n)));
    return Response.json({ results });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
