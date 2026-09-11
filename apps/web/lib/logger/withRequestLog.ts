import 'server-only';
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { serverLogger } from './server';
import { createClient } from '@/lib/pocketbase/server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteHandler<Ctx = any> = (req: NextRequest, ctx: Ctx) => Promise<Response> | Response;

/** Best-effort current user id, read the same way requireUser() does (via
 *  the pb_auth cookie) but without throwing when there isn't one: logging
 *  must never be the reason a request fails. */
async function resolveUserId(): Promise<string | undefined> {
  try {
    const pb = await createClient();
    const id = pb.authStore.record?.id;
    return typeof id === 'string' ? id : undefined;
  } catch {
    return undefined;
  }
}

/** Reads the `error` field out of a JSON response body without consuming
 *  the response that's actually going back to the client. Returns undefined
 *  for non-JSON or unreadable bodies (e.g. a binary/stream response). */
async function readErrorField(res: Response): Promise<string | undefined> {
  try {
    const json: unknown = await res.clone().json();
    if (json && typeof json === 'object' && typeof (json as { error?: unknown }).error === 'string') {
      return (json as { error: string }).error;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Wraps a Next.js API route handler with request-scoped logging so triage
 * can correlate a client-reported failure with what happened server-side.
 * Derives (or reuses, via the x-request-id header proxy.ts sets) a request
 * id, and after the handler runs, writes ONE server log entry for anything
 * worth a human/AI look:
 *   - a thrown error -> level 'error', and the wrapper returns a generic
 *     500 JSON response (routes that already catch their own errors and
 *     return JSON never hit this path: see fromError in lib/upsertTrack).
 *   - a 5xx response the handler returned -> level 'error' (502/504, which
 *     are usually yt-dlp/python being flaky rather than our bug, log at
 *     'warn' instead).
 *   - a 429 (rate limited) response -> level 'warn'.
 * 2xx/3xx/4xx (other than 429) are not logged here. This never changes the
 * response a route produces: the wrapper only observes and rethrows/returns
 * exactly what the handler gave it, except for the uncaught-throw case.
 */
export function withRequestLog<Ctx = unknown>(
  name: string,
  handler: RouteHandler<Ctx>,
): RouteHandler<Ctx> {
  return async (req: NextRequest, ctx: Ctx): Promise<Response> => {
    const reqId = req.headers.get('x-request-id') || randomUUID();
    const method = req.method;
    const start = Date.now();
    const userId = await resolveUserId();

    let res: Response;
    try {
      res = await handler(req, ctx);
    } catch (e) {
      const durationMs = Date.now() - start;
      serverLogger.error(
        'api',
        e instanceof Error ? e.message : 'unhandled route error',
        { method, durationMs },
        e,
        { reqId, route: name, userId },
      );
      return Response.json({ error: 'Internal error' }, { status: 500 });
    }

    const durationMs = Date.now() - start;
    if (res.status === 429) {
      serverLogger.warn('api', `${method} ${name} -> 429`, { status: 429, durationMs }, undefined, {
        reqId,
        route: name,
        userId,
      });
    } else if (res.status === 502 || res.status === 504) {
      const error = await readErrorField(res);
      serverLogger.warn(
        'api',
        `${method} ${name} -> ${res.status}`,
        { status: res.status, error, durationMs },
        undefined,
        { reqId, route: name, userId },
      );
    } else if (res.status >= 500) {
      const error = await readErrorField(res);
      serverLogger.error(
        'api',
        `${method} ${name} -> ${res.status}`,
        { status: res.status, error, durationMs },
        undefined,
        { reqId, route: name, userId },
      );
    }

    return res;
  };
}
