import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { loadSession, assertHost } from '@/lib/sessions';

/** Host publishes which queue position is playing (drives guests' screens). */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/sessions/[id]/now'>) {
  try {
    const { pb, user } = await requireUser();
    const { id } = await ctx.params;
    const session = await loadSession(pb, id);
    assertHost(session, user.id);
    const body = (await request.json().catch(() => null)) as { index?: number } | null;
    const index = Number(body?.index);
    if (!Number.isFinite(index) || index < 0) return jsonError('index required', 400);
    await pb.collection('sessions').update(session.id, { now_index: Math.floor(index) });
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
