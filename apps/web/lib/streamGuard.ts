/** Timeouts for a stream we do not control.
 *
 *  A proxied upstream (googlevideo) can accept the connection, answer with a
 *  200, and then simply stop sending. Nothing below us minds: `fetch` has no
 *  read timeout in Node or in a browser, so the client is left holding an open
 *  response that will never finish — the half-minute freeze an unplayable song
 *  used to cause. These two helpers put a clock on both halves of that: how
 *  long we wait for the response to START, and how long a gap between body
 *  chunks is allowed once it has.
 *
 *  Pure (they only need WHATWG streams and timers) so the behaviour is
 *  testable without a server. */

/** How long the upstream gets to answer with headers before we call it dead.
 *  Resolving the URL already took a yt-dlp run; the fetch itself is one
 *  request to a CDN, so seconds, not tens of seconds. */
export const UPSTREAM_HEADERS_TIMEOUT_MS = 6_000;

/** Longest silence allowed between two chunks of a proxied body. Long enough
 *  that YouTube's throttling (it paces a stream at roughly playback speed)
 *  never trips it, short enough that the listener gets an error rather than a
 *  frozen player. */
export const UPSTREAM_STALL_TIMEOUT_MS = 10_000;

/** `fetch`, with a clock on the RESPONSE only.
 *
 *  `AbortSignal.timeout()` cannot be used for this: it aborts the whole
 *  exchange, body included, so a five-minute song streaming happily would be
 *  cut off six seconds in. This starts the clock with the request and stops it
 *  the moment the headers land, leaving the body to `withStallTimeout`. */
export async function fetchWithHeadersTimeout(
  url: string,
  init: RequestInit,
  ms: number = UPSTREAM_HEADERS_TIMEOUT_MS,
): Promise<Response> {
  const control = new AbortController();
  const timer = setTimeout(
    () => control.abort(new Error(`the upstream sent no response in ${Math.round(ms / 1000)}s`)),
    ms,
  );
  try {
    return await fetch(url, { ...init, signal: control.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** The error a stalled body fails with. Its message reaches the client as a
 *  broken response, and the server log. */
export class StreamStalledError extends Error {
  constructor(ms: number) {
    super(`the upstream stopped sending data for ${Math.round(ms / 1000)}s`);
    this.name = 'StreamStalledError';
  }
}

/** Wraps a body so a gap longer than `ms` between chunks ERRORS the stream
 *  instead of waiting forever.
 *
 *  The client then sees a broken response (a truncated body against a declared
 *  Content-Length) which every player treats as a failure — which is the point:
 *  a failure can be reported and retried, an endless wait cannot. `null` in
 *  (a bodyless response) is `null` out. */
export function withStallTimeout(
  body: ReadableStream<Uint8Array> | null,
  ms: number = UPSTREAM_STALL_TIMEOUT_MS,
  onStall?: (e: StreamStalledError) => void,
): ReadableStream<Uint8Array> | null {
  if (!body) return null;
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const stalled = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new StreamStalledError(ms)), ms);
        });
        const next = await Promise.race([reader.read(), stalled]);
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      } catch (e) {
        if (e instanceof StreamStalledError) onStall?.(e);
        controller.error(e);
        void reader.cancel().catch(() => {});
      } finally {
        clearTimeout(timer);
      }
    },
    cancel(reason) {
      void reader.cancel(reason).catch(() => {});
    },
  });
}
