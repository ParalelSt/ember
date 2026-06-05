import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError, jsonError } from '@/lib/upsertTrack';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_NAME_LEN = 50;

export async function PATCH(req: NextRequest) {
  try {
    const { user, pb } = await requireUser();
    const form = await req.formData();

    const patch = new FormData();
    let hasChange = false;

    if (form.has('name')) {
      const name = String(form.get('name') ?? '').slice(0, MAX_NAME_LEN);
      patch.set('name', name);
      hasChange = true;
    }

    if (form.get('removeAvatar') === 'true') {
      // PB convention: setting a file field to empty string clears it.
      patch.set('avatar', '');
      hasChange = true;
    } else {
      const file = form.get('avatar');
      if (file instanceof File && file.size > 0) {
        if (file.size > MAX_AVATAR_BYTES) return jsonError('Image must be under 5 MB', 400);
        if (!ALLOWED_MIMES.has(file.type)) return jsonError('Unsupported image type', 400);
        patch.set('avatar', file);
        hasChange = true;
      }
    }

    if (!hasChange) return Response.json({ ok: true });

    const updated = await pb.collection('users').update(user.id, patch);
    return Response.json({
      ok: true,
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name ?? '',
        avatarUrl: updated.avatar ? pb.files.getURL(updated, updated.avatar) : null,
      },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}
