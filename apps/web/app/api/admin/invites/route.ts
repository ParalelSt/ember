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
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { isUniqueHit } from '@/lib/pocketbase/uniqueHit';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AdminInvite {
  id: string;
  email: string;
  created: string;
}

export const GET = withRequestLog('admin/invites', async (_req: NextRequest) => {
  try {
    await requireAdmin();
    const pb = await createAdminClient();
    const records = await pb.collection('allowed_emails').getFullList({ sort: '-created' });
    return Response.json({
      invites: records.map((r) => ({
        id: r.id,
        email: r.email as string,
        created: r.created,
      })),
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    if (e instanceof ForbiddenError) return forbiddenResponse();
    return fromError(e);
  }
});

export const POST = withRequestLog('admin/invites', async (req: NextRequest) => {
  try {
    await requireAdmin();
    const body = (await req.json().catch(() => null)) as { email?: unknown } | null;
    if (!body || typeof body !== 'object') return jsonError('Invalid email', 400);
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return jsonError('Invalid email', 400);

    const pb = await createAdminClient();
    try {
      const created = await pb.collection('allowed_emails').create({ email });
      return Response.json({
        ok: true,
        invite: {
          id: created.id,
          email: created.email as string,
          created: created.created,
        },
      });
    } catch (e) {
      // Only the unique index means "already invited"; any other 400 (an
      // address PocketBase's email check refuses) falls through to its
      // own message.
      if (isUniqueHit(e, ['email'])) return jsonError('That email is already on the list', 409);
      throw e;
    }
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    if (e instanceof ForbiddenError) return forbiddenResponse();
    return fromError(e);
  }
});
