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

const MAX_NAME_LEN = 50;

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user: actor } = await requireAdmin();
    const { id } = await ctx.params;

    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      isAdmin?: boolean;
    };

    if (id === actor.id && body.isAdmin === false) {
      return jsonError("You can't remove your own admin role", 400);
    }

    const patch: Record<string, unknown> = {};
    if (typeof body.name === 'string') patch.name = body.name.slice(0, MAX_NAME_LEN);
    if (typeof body.isAdmin === 'boolean') patch.is_admin = body.isAdmin;
    if (Object.keys(patch).length === 0) return Response.json({ ok: true });

    const pb = await createAdminClient();
    const updated = await pb.collection('users').update(id, patch);
    return Response.json({
      ok: true,
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name ?? '',
        avatarUrl: updated.avatar ? pb.files.getURL(updated, updated.avatar as string) : null,
        isAdmin: updated.is_admin === true,
        created: updated.created,
      },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    if (e instanceof ForbiddenError) return forbiddenResponse();
    return fromError(e);
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { user: actor } = await requireAdmin();
    const { id } = await ctx.params;
    if (id === actor.id) {
      return jsonError("You can't delete your own account from the admin panel", 400);
    }
    const pb = await createAdminClient();
    await pb.collection('users').delete(id);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    if (e instanceof ForbiddenError) return forbiddenResponse();
    return fromError(e);
  }
}
