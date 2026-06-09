import type { NextRequest } from 'next/server';
import {
  ForbiddenError,
  forbiddenResponse,
  requireAdmin,
  UnauthorizedError,
  unauthorizedResponse,
} from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { serverLogger } from '@/lib/logger/server';

const MIN_LEN = 8;
const MAX_LEN = 71;

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user: actor } = await requireAdmin();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { password?: string };
    const pw = typeof body.password === 'string' ? body.password : '';

    if (pw.trim().length === 0) return jsonError('Password cannot be blank', 400);
    if (pw.length < MIN_LEN) return jsonError(`Password must be at least ${MIN_LEN} characters`, 400);
    if (pw.length > MAX_LEN) return jsonError(`Password must be ${MAX_LEN} characters or fewer`, 400);

    const pb = await createAdminClient();
    const target = await pb.collection('users').update(id, {
      password: pw,
      passwordConfirm: pw,
    });

    serverLogger.error('admin', 'password-reset', {
      target: target.email,
      targetId: target.id,
      by: actor.email,
      byId: actor.id,
    });

    return Response.json({
      ok: true,
      selfReset: id === actor.id,
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    if (e instanceof ForbiddenError) return forbiddenResponse();
    return fromError(e);
  }
}
