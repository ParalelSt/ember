import type { NextRequest } from 'next/server';
import {
  ForbiddenError,
  forbiddenResponse,
  requireAdmin,
  UnauthorizedError,
  unauthorizedResponse,
} from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { mapTrackRow, type TrackRecord } from '@/lib/mapTrack';
import { fromError } from '@/lib/upsertTrack';

// `id` in the URL is PB's internal record id, NOT the Track.id external id.
// The admin list endpoint returns `recordId` alongside `id` so the UI can
// route mutations here without an extra lookup.

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as {
      title?: string;
      artist?: string;
      album?: string;
    };
    const patch: Record<string, unknown> = {};
    if (typeof body.title === 'string')  patch.title  = body.title.slice(0, 500);
    if (typeof body.artist === 'string') patch.artist = body.artist.slice(0, 500);
    if (typeof body.album === 'string')  patch.album  = body.album.slice(0, 500);
    if (Object.keys(patch).length === 0) return Response.json({ ok: true });

    const pb = await createAdminClient();
    const updated = await pb.collection('tracks').update(id, patch);
    const mapped = mapTrackRow(updated as unknown as TrackRecord);
    return Response.json({
      ok: true,
      track: mapped ? { ...mapped, recordId: updated.id } : null,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    if (e instanceof ForbiddenError) return forbiddenResponse();
    return fromError(e);
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin();
    const { id } = await ctx.params;
    const pb = await createAdminClient();
    await pb.collection('tracks').delete(id);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    if (e instanceof ForbiddenError) return forbiddenResponse();
    return fromError(e);
  }
}
