import type { NextRequest } from 'next/server';
import type { ClientResponseError } from 'pocketbase';
import { createAdminClient } from '@/lib/pocketbase/server';
import { fromError, jsonError } from '@/lib/upsertTrack';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: string };
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) return jsonError('Invalid email', 400);

    const pb = await createAdminClient();

    const onList = await pb
      .collection('allowed_emails')
      .getFirstListItem(`email = "${escape(email)}"`)
      .catch((e: ClientResponseError) => (e?.status === 404 ? null : Promise.reject(e)));
    if (!onList) return Response.json({ status: 'denied' as const });

    const existing = await pb
      .collection('users')
      .getFirstListItem(`email = "${escape(email)}"`)
      .catch((e: ClientResponseError) => (e?.status === 404 ? null : Promise.reject(e)));

    return Response.json({ status: existing ? ('existing' as const) : ('new' as const) });
  } catch (e) {
    return fromError(e);
  }
}

function escape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
