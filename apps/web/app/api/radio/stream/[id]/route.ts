import type { NextRequest } from 'next/server';
import { Readable } from 'node:stream';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { serverLogger } from '@/lib/logger/server';
import { rateLimitResponse } from '@/lib/rateLimit';
import { RADIO_LIMITS } from '@/lib/radio/routes';
import { radioService } from '@/lib/radio/service';
import { radioUserAgent } from '@/lib/radio/radioBrowser';
import { isStationId } from '@/lib/radio/station';
import { audioContentType, openUpstream, streamSlots } from '@/lib/radio/streamProxy';
import { withStallTimeout } from '@/lib/streamGuard';
import { jsonError } from '@/lib/upsertTrack';

/** A station's gap between two chunks before the stream counts as dead.
 *  Stations send a steady trickle, so a long silence is a dead one. */
const STALL_MS = 20_000;

const NO_STORE = { 'Cache-Control': 'no-store' };

/** A live station, streamed through this host: GET /api/radio/stream/<id>.
 *
 *  Why a proxy: most stations still stream over plain http, which a page on
 *  https may not play, and the web player's audio graph (equalizer, volume
 *  levelling) can only read audio from its own origin. Why it is not an
 *  open proxy: it takes a station id, never an address, and the address it
 *  fetches is the one Radio Browser listed for that id (lib/radio/service),
 *  on a public internet address only (lib/radio/streamProxy). Members only,
 *  a budget of new streams per minute, and at most two streams per member at
 *  once (a new one ends their oldest). */
export const GET = withRequestLog('radio/stream/[id]', async (request: NextRequest, ctx: RouteContext<'/api/radio/stream/[id]'>) => {
  const { id } = await ctx.params;
  if (!isStationId(id)) return jsonError('not a station id', 400);
  let userId: string;
  try {
    userId = (await requireUser()).user.id;
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return jsonError('Could not check who is asking', 502);
  }
  const limited = rateLimitResponse(`radio-stream:${userId}`, RADIO_LIMITS.stream);
  if (limited) return limited;

  let target: { url: string; codec: string } | null;
  try {
    target = await radioService().streamTarget(id);
  } catch {
    return Response.json({ error: 'Radio Browser could not be reached right now.' }, { status: 502, headers: NO_STORE });
  }
  if (!target) return Response.json({ error: 'No such station, or it cannot play here.' }, { status: 404, headers: NO_STORE });

  const control = new AbortController();
  const slot = streamSlots().acquire(userId, () => control.abort());
  if (!slot) {
    return Response.json({ error: 'Too many radio streams are playing on this server right now.' }, { status: 503, headers: { ...NO_STORE, 'Retry-After': '30' } });
  }
  const onClientGone = () => control.abort();
  request.signal?.addEventListener('abort', onClientGone, { once: true });
  const finish = () => {
    slot.release();
    request.signal?.removeEventListener('abort', onClientGone);
  };

  let upstream: Awaited<ReturnType<typeof openUpstream>>;
  try {
    upstream = await openUpstream(target.url, { userAgent: radioUserAgent(), signal: control.signal });
  } catch (e) {
    finish();
    serverLogger.warn('radio', 'station stream could not be opened', { stationId: id, error: e instanceof Error ? e.message : String(e) });
    return Response.json({ error: 'This station is not answering right now.', cause: 'stream-failed' }, { status: 502, headers: NO_STORE });
  }
  const type = audioContentType(upstream.headers['content-type'], target.codec);
  if (upstream.status !== 200 || !type) {
    upstream.close();
    finish();
    serverLogger.warn('radio', 'station stream refused', { stationId: id, status: upstream.status, type: upstream.headers['content-type'] ?? null });
    return Response.json({ error: 'This station is not answering right now.', cause: 'stream-failed' }, { status: 502, headers: NO_STORE });
  }

  // The station ending, going quiet, or the listener leaving all end the
  // stream and free the slot, once.
  const guarded = withStallTimeout(Readable.toWeb(upstream.body) as ReadableStream<Uint8Array>, STALL_MS)!;
  const reader = guarded.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(c) {
      try {
        const next = await reader.read();
        if (next.done) {
          finish();
          c.close();
        } else {
          c.enqueue(next.value);
        }
      } catch (e) {
        finish();
        upstream.close();
        c.error(e);
      }
    },
    cancel(reason) {
      finish();
      upstream.close();
      void reader.cancel(reason).catch(() => {});
    },
  });
  // A slot taken over by the member's next stream ends this one.
  control.signal.addEventListener('abort', () => {
    upstream.close();
    void reader.cancel().catch(() => {});
  }, { once: true });

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': type,
      ...NO_STORE,
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
