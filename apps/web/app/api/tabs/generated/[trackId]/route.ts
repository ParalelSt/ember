import type { NextRequest } from 'next/server';
import fs from 'node:fs';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { rateLimitResponse } from '@/lib/rateLimit';
import { ensureDownloaded } from '@/lib/sources/youtube';
import { resolveUploadPath } from '@/lib/uploads';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import {
  generatedTabPath,
  generationStatus,
  parseTrackKey,
  startGeneration,
  type TrackKey,
} from '@/lib/tabGenerate';

/** A guitar tab generated from the track's own recording.
 *
 *  GET  — the alphaTex if it exists (200, text/plain), 202 while a job is
 *         running, 409 with the reason if the last attempt failed, 404 if
 *         nothing has been asked for yet.
 *  POST — start it. 200 if it already exists, 202 once the job is queued.
 *
 *  Generated tabs are shared by everyone on the server, like the audio they
 *  come from, so there is no ownership check beyond being signed in. */

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
    const { trackId } = await ctx.params;
    const key = parseTrackKey(decodeURIComponent(trackId));
    if (!key) return jsonError('Tabs can only be generated for YouTube and uploaded songs.', 400);

    const status = generationStatus(key.key);
    if (status.status === 'ready') {
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
    const { trackId } = await ctx.params;
    const key = parseTrackKey(decodeURIComponent(trackId));
    if (!key) return jsonError('Tabs can only be generated for YouTube and uploaded songs.', 400);

    if (generationStatus(key.key).status === 'ready') return Response.json({ status: 'ready' });

    // A job costs minutes of CPU, so this is per member and deliberately low.
    // Joining a job that is already running is free and not counted.
    if (generationStatus(key.key).status !== 'running') {
      const limited = rateLimitResponse(`tab-generate:${user.id}`, { windowMs: 60 * 60 * 1000, max: 5 });
      if (limited) return limited;
    }

    const audio = await audioFor(key);
    if (!audio) return jsonError('Ember has no recording of that song to transcribe.', 404);

    const title = (request.nextUrl.searchParams.get('title') ?? '').slice(0, 200) || key.sourceId;
    // Fire and forget: the client polls GET. Errors are remembered by the
    // queue and surfaced there, so an unhandled rejection here is not one.
    startGeneration(key.key, audio, title).catch(() => {});
    return Response.json({ status: 'running' }, { status: 202 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
