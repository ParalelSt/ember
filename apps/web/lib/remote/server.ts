import 'server-only';
import { UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';

/** Per-user limits for the remote routes (docs/plans/2026-11-08-device-
 *  remote-control.md, "Security"). */
export const REMOTE_LIMITS = {
  beat: { windowMs: 60_000, max: 90 },
  state: { windowMs: 60_000, max: 90 },
  command: { windowMs: 60_000, max: 60 },
  setQueue: { windowMs: 60_000, max: 20 },
} as const;

/** A body bigger than this is refused before it is parsed: 300 full tracks
 *  are about 120 KB. */
export const MAX_BODY_BYTES = 512 * 1024;

/** The JSON body, or a Response refusing it (too big, not JSON). */
export async function readJson(req: Request): Promise<unknown | Response> {
  const text = await req.text().catch(() => '');
  if (text.length > MAX_BODY_BYTES) return Response.json({ error: 'Too big' }, { status: 413 });
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return Response.json({ error: 'Not JSON' }, { status: 400 });
  }
}

export function remoteErrorResponse(e: unknown): Response {
  if (e instanceof UnauthorizedError) return unauthorizedResponse();
  return fromError(e);
}
