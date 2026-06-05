import type { NextRequest } from 'next/server';
import {
  ForbiddenError,
  forbiddenResponse,
  requireAdmin,
  UnauthorizedError,
  unauthorizedResponse,
} from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { fromError } from '@/lib/upsertTrack';

export async function GET(_req: NextRequest) {
  try {
    await requireAdmin();
    const pb = await createAdminClient();
    const records = await pb.collection('users').getFullList({ sort: '-created' });
    return Response.json({
      users: records.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name ?? '',
        avatarUrl: r.avatar ? pb.files.getURL(r, r.avatar as string) : null,
        isAdmin: r.is_admin === true,
        created: r.created,
      })),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    if (e instanceof ForbiddenError) return forbiddenResponse();
    return fromError(e);
  }
}
