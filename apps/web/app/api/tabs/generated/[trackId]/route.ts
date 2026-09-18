import type { NextRequest } from 'next/server';
import fs from 'node:fs';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { rateLimitResponse } from '@/lib/rateLimit';
import { ensureDownloaded } from '@/lib/sources/youtube';
import { resolveUploadPath } from '@/lib/uploads';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { serverLogger } from '@/lib/logger/server';
import { recordGenerated } from '@/lib/tabStore';
import {
  generatedTabFile,
  generatedTabPath,
  generationStatus,
  parseTrackKey,
  startGeneration,
  type TrackKey,
} from '@/lib/tabGenerate';

/** A guitar tab generated from the track's own recording.
 *
 *  GET : the alphaTex if it exists (200, text/plain), 202 while a job is
 *         running, 409 with the reason if the last attempt failed, 404 if
 *         nothing has been asked for yet.
 *  POST: start it. 200 if it already exists, 202 once the job is queued.
 *
 *  Generated tabs are shared by everyone on the server, like the audio they
 *  come from, so there is no ownership check beyond being signed in.
 *
 *  Each one also gets a row in the `tabs` store (kind "generated"), so it is
 *  found by song like a file is. The row is written when the job finishes,
 *  or on the first GET of a tab generated before the store existed. */

/** Keys whose row is known to exist, so a GET costs no extra query after
 *  the first. */
const recorded = new Set<string>();
/** Who started each job, so whichever request records the row (the job's
 *  own completion or a poll that sees the file first) names the same
 *  member. */
const requestedBy = new Map<string, { userId: string; title: string; artist: string }>();

/** Title and artist for the row: the upload or the shared tracks row, else
 *  what the client said, else the bare id. */
async function trackMeta(key: TrackKey, trackId: string, fallback: { title: string; artist: string }) {
  const pb = await createAdminClient();
  const row =
    key.source === 'upload'
      ? await pb.collection('uploads').getOne(key.sourceId).catch(() => null)
      : await pb
          .collection('tracks')
          .getFirstListItem(pb.filter('external_id = {:id}', { id: trackId }))
          .catch(() => null);
  return {
    title: String(row?.title || fallback.title || key.sourceId),
    artist: String(row?.artist || fallback.artist || ''),
  };
}

async function ensureRow(
  key: TrackKey,
  trackId: string,
  userId: string | null,
  fallback: { title: string; artist: string },
): Promise<void> {
  if (recorded.has(key.key)) return;
  try {
    const meta = await trackMeta(key, trackId, fallback);
    const pb = await createAdminClient();
    await recordGenerated(pb, { trackId, ...meta, userId, file: generatedTabFile(key.key) });
    recorded.add(key.key);
  } catch (e) {
    // The tab itself is on disk and served either way; the row only makes
    // it findable by song, and the next request tries again.
    serverLogger.error('tabs', 'recording generated tab failed', { key: key.key }, e);
  }
}

async function audioFor(key: TrackKey): Promise<string | null> {
  if (key.source === 'youtube') return ensureDownloaded(key.sourceId);
  const pb = await createAdminClient();
  const row = await pb.collection('uploads').getOne(key.sourceId).catch(() => null);
  if (!row) return null;
  const full = resolveUploadPath(String(row.filename ?? ''));
  return full && fs.existsSync(full) ? full : null;
}

export const GET = withRequestLog('tabs/generated/[trackId]', async (_req: NextRequest, ctx: RouteContext<'/api/tabs/generated/[trackId]'>) => {
  try {
    await requireUser();
    const trackId = decodeURIComponent((await ctx.params).trackId);
    const key = parseTrackKey(trackId);
    if (!key) return jsonError('Tabs can only be generated for YouTube and uploaded songs.', 400);

    const status = generationStatus(key.key);
    if (status.status === 'ready') {
      const by = requestedBy.get(key.key);
      await ensureRow(key, trackId, by?.userId ?? null, by ?? { title: '', artist: '' });
      const text = await fs.promises.readFile(generatedTabPath(key.key), 'utf8');
      return new Response(text, {
        headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'private, max-age=3600' },
      });
    }
    if (status.status === 'running') return Response.json(status, { status: 202 });
    if (status.status === 'failed') return Response.json(status, { status: 409 });
    return Response.json(status, { status: 404 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

export const POST = withRequestLog('tabs/generated/[trackId]', async (request: NextRequest, ctx: RouteContext<'/api/tabs/generated/[trackId]'>) => {
  try {
    const { user } = await requireUser();
    const trackId = decodeURIComponent((await ctx.params).trackId);
    const key = parseTrackKey(trackId);
    if (!key) return jsonError('Tabs can only be generated for YouTube and uploaded songs.', 400);

    const params = request.nextUrl.searchParams;
    const said = {
      title: (params.get('title') ?? '').slice(0, 200),
      artist: (params.get('artist') ?? '').slice(0, 200),
    };

    if (generationStatus(key.key).status === 'ready') {
      await ensureRow(key, trackId, user.id, said);
      return Response.json({ status: 'ready' });
    }

    // A job costs minutes of CPU, so this is per member and deliberately low.
    // Joining a job that is already running is free and not counted.
    if (generationStatus(key.key).status !== 'running') {
      const limited = rateLimitResponse(`tab-generate:${user.id}`, { windowMs: 60 * 60 * 1000, max: 5 });
      if (limited) return limited;
    }

    const audio = await audioFor(key);
    if (!audio) return jsonError('Ember has no recording of that song to transcribe.', 404);

    const title = said.title || key.sourceId;
    if (!requestedBy.has(key.key)) requestedBy.set(key.key, { userId: user.id, ...said });
    // Fire and forget: the client polls GET. Errors are remembered by the
    // queue and surfaced there, so an unhandled rejection here is not one.
    // The row is written as soon as the file exists, naming who asked.
    startGeneration(key.key, audio, title)
      .then(async () => {
        const by = requestedBy.get(key.key);
        await ensureRow(key, trackId, by?.userId ?? user.id, by ?? said);
      })
      .catch(() => {})
      .finally(() => requestedBy.delete(key.key));
    return Response.json({ status: 'running' }, { status: 202 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
