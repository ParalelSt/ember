import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';

/** Per-user changelog state, synced across devices:
 *
 *   seenVersion → the app version the user last marked read ('' = never)
 *   hideNew     → "Don't show New tags"
 *
 *  Same shape as api/privacy. The fields are added on boot by
 *  pb_hooks/ensure_changelog_fields.pb.js. */

export interface ChangelogState {
  seenVersion: string;
  hideNew: boolean;
}

const VERSION_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

function toState(record: Record<string, unknown>): ChangelogState {
  return {
    seenVersion: typeof record.changelog_seen_version === 'string' ? record.changelog_seen_version : '',
    hideNew: record.changelog_hide_new === true,
  };
}

export const GET = withRequestLog('changelog', async () => {
  try {
    const { pb, user } = await requireUser();
    const record = await pb.collection('users').getOne(user.id);
    return Response.json(toState(record) satisfies ChangelogState);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

export const PATCH = withRequestLog('changelog', async (request: NextRequest) => {
  try {
    const { pb, user } = await requireUser();
    const body = (await request.json().catch(() => null)) as Partial<Record<keyof ChangelogState, unknown>> | null;

    const patch: Record<string, string | boolean> = {};
    if (typeof body?.seenVersion === 'string' && VERSION_RE.test(body.seenVersion)) {
      patch.changelog_seen_version = body.seenVersion;
    }
    if (typeof body?.hideNew === 'boolean') patch.changelog_hide_new = body.hideNew;

    if (Object.keys(patch).length === 0) {
      // Nothing recognised: say so rather than reporting a successful no-op.
      return Response.json({ error: 'No changelog settings in request' }, { status: 400 });
    }

    const updated = await pb.collection('users').update(user.id, patch);
    return Response.json(toState(updated) satisfies ChangelogState);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
