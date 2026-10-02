import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface ServerLogContext {
  reqId?: string;
  route?: string;
  userId?: string;
}

/** Request-scoped context set by withRequestLog, so any serverLogger call
 *  made while handling a request carries its reqId, route and userId even
 *  when the caller (fromError and friends) passes no ctx of its own. Its own
 *  module (re-exported by ./server) so a test that mocks the logger still
 *  gets the real outsideRequest below. */
export const requestContext = new AsyncLocalStorage<ServerLogContext>();

/** Runs `fn` outside any request's context. For work that serves everyone
 *  (a queue that holds other members' songs or imports) but that some
 *  member's request happened to start: inside that request's context, every
 *  later entry it logged was put down to that member, and so landed in their
 *  bug reports even when it was about someone else's song. Logged outside a
 *  request, an entry is server-wide, and a bug report keeps only its bare
 *  message (lib/reports/reporterEntries.ts). */
export function outsideRequest<T>(fn: () => T): T {
  return requestContext.exit(fn);
}
