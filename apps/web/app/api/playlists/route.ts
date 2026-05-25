import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';

export async function GET() {
  try {
    const { pb, user } = await requireUser();
    const records = await pb.collection('playlists').getFullList({
      filter: `user = "${user.id}"`,
      sort: '-created',
    });
    const playlists = records.map((r) => ({
      id: r.id,
      name: String(r.name ?? ''),
      created_at: String(r.created ?? ''),
    }));
    return Response.json({ playlists });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { pb, user } = await requireUser();
    const body = (await request.json().catch(() => null)) as { name?: string } | null;
    const name = String(body?.name ?? '').trim();
    if (!name) return jsonError('name required', 400);
    const r = await pb.collection('playlists').create({ user: user.id, name });
    return Response.json({
      playlist: { id: r.id, name: String(r.name ?? ''), created_at: String(r.created ?? '') },
    }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
