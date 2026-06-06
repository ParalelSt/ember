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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface AdminInvite {
  id: string;
  email: string;
  created: string;
}

export async function GET(_req: NextRequest) {
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
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const body = (await req.json().catch(() => ({}))) as { email?: string };
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
      const status = (e as { status?: number }).status;
      if (status === 400) return jsonError('That email is already on the list', 409);
      throw e;
    }
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    if (e instanceof ForbiddenError) return forbiddenResponse();
    return fromError(e);
  }
}
