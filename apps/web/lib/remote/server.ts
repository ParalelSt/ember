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

/** The JSON body, or a Response refusing it (too big, not JSON). A body
 *  that says it is too big is refused unread; one that turns out too big is
 *  cut off as soon as it passes the limit. */
export async function readJson(req: Request): Promise<unknown | Response> {
  const tooBig = () => Response.json({ error: 'Too big' }, { status: 413 });
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooBig();
  if (!req.body) return Response.json({ error: 'Not JSON' }, { status: 400 });
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return tooBig();
      }
      chunks.push(value);
    }
  } catch {
    return Response.json({ error: 'Not JSON' }, { status: 400 });
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    return Response.json({ error: 'Not JSON' }, { status: 400 });
  }
}

export function remoteErrorResponse(e: unknown): Response {
  if (e instanceof UnauthorizedError) return unauthorizedResponse();
  return fromError(e);
}
