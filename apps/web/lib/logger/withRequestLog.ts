import 'server-only';
import { randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { serverLogger, requestContext } from './server';
import { createClient } from '@/lib/pocketbase/server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteHandler<Ctx = any> = (req: NextRequest, ctx: Ctx) => Promise<Response> | Response;

/** Routes where a 429 is the automatic-report quota doing its job, not a
 *  problem worth a human's attention: keep it out of the digest by logging
 *  it at 'info' instead of 'warn'. A real 5xx from these routes still logs
 *  normally (see below), so an actual failure stays visible. */
const QUIET_429_ROUTES = new Set(['bug-report', 'requests']);

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
  // Only JSON bodies are inspected: cloning and parsing a streamed audio or
  // proxied upstream response would buffer the whole stream before it is
  // handed back to the client.
  if (!res.headers.get('content-type')?.includes('json')) return undefined;
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
 *     are usually yt-dlp/python being flaky rather than our bug, and 503,
 *     a busy host refusing a prefetch, log at 'warn' instead).
 *   - a 429 (rate limited) response -> level 'warn', except on
 *     QUIET_429_ROUTES (bug-report, requests): a client that has used up its
 *     automatic-report quota getting a 429 back is expected, not noteworthy,
 *     so those log at 'info' instead and never reach the digest.
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
      res = await requestContext.run({ reqId, route: name, userId }, () => handler(req, ctx));
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
      const level = QUIET_429_ROUTES.has(name) ? 'info' : 'warn';
      serverLogger[level]('api', `${method} ${name} -> 429`, { status: 429, durationMs }, undefined, {
        reqId,
        route: name,
        userId,
      });
    } else if (res.status === 502 || res.status === 503 || res.status === 504) {
      // 503 is the stream route telling a prefetch the host is busy
      // (lib/downloadGate): expected under load, so a warning, not a bug.
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
