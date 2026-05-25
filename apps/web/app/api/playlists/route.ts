import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';

export async function GET() {
  try {
    const { supabase } = await requireUser();
    const { data, error } = await supabase
      .from('playlists')
      .select('id, name, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return Response.json({ playlists: data });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser();
    const body = (await request.json().catch(() => null)) as { name?: string } | null;
    const name = String(body?.name ?? '').trim();
    if (!name) return jsonError('name required', 400);
    const { data, error } = await supabase
      .from('playlists')
      .insert({ name, user_id: user.id })
      .select('id, name, created_at')
      .single();
    if (error) throw error;
    return Response.json({ playlist: data }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
