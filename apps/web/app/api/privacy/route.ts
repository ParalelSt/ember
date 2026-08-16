import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';

/** Two independent "don't broadcast what I'm playing" switches:
 *
 *   shareDiscord   → Discord rich presence
 *   shareListening → the "Friends are listening to" section
 *
 *  The API speaks in `share*` because that's how the UI reads, while storage
 *  is inverted (`hide_*`) so existing users default to visible without a
 *  backfill. See pb_hooks/ensure_privacy_fields.pb.js. */

export interface PrivacySettings {
  shareDiscord: boolean;
  shareListening: boolean;
}

export async function GET() {
  try {
    const { pb, user } = await requireUser();
    const record = await pb.collection('users').getOne(user.id);
    return Response.json({
      shareDiscord: record.hide_discord !== true,
      shareListening: record.hide_listening !== true,
    } satisfies PrivacySettings);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { pb, user } = await requireUser();
    const body = (await request.json().catch(() => null)) as Partial<PrivacySettings> | null;

    const patch: Record<string, boolean> = {};
    if (typeof body?.shareDiscord === 'boolean') patch.hide_discord = !body.shareDiscord;
    if (typeof body?.shareListening === 'boolean') patch.hide_listening = !body.shareListening;

    if (Object.keys(patch).length === 0) {
      // Nothing recognised — say so rather than reporting a successful no-op,
      // which would look like the toggle saved when it didn't.
      return Response.json({ error: 'No privacy settings in request' }, { status: 400 });
    }

    const updated = await pb.collection('users').update(user.id, patch);
    return Response.json({
      shareDiscord: updated.hide_discord !== true,
      shareListening: updated.hide_listening !== true,
    } satisfies PrivacySettings);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
