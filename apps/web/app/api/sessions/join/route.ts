import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';

/** Resolve a join code to a live session. */
export async function POST(request: NextRequest) {
  try {
    const { pb } = await requireUser();
    const body = (await request.json().catch(() => null)) as { code?: string } | null;
    const code = String(body?.code ?? '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '');
    if (!code) return jsonError('Enter a join code.', 400);
    try {
      const session = await pb
        .collection('sessions')
        .getFirstListItem(`code = "${code}" && active = true`);
      return Response.json({ session: { id: session.id, name: String(session.name) } });
    } catch {
      return jsonError('No live session with that code.', 404);
    }
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
