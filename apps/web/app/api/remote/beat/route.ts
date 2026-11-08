import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { rateLimitResponse } from '@/lib/rateLimit';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { parseBeat } from '@/lib/remote/parse';
import { REMOTE_LIMITS, readJson, remoteErrorResponse } from '@/lib/remote/server';
import { remoteStore } from '@/lib/remote/store';
import { HOLD_MS } from '@/lib/remote/types';

/** The playing device's heartbeat: what it plays, and the commands waiting
 *  for it in the same answer. Memory only, keyed by the session's user. */
export const POST = withRequestLog('remote/beat', async (req: NextRequest) => {
  try {
    const { user } = await requireUser();
    const limited = rateLimitResponse(`remote-beat:${user.id}`, REMOTE_LIMITS.beat);
    if (limited) return limited;
    const body = await readJson(req);
    if (body instanceof Response) return body;
    const beat = parseBeat(body);
    if (!beat) return Response.json({ error: 'Not a beat' }, { status: 400 });
    const store = remoteStore();
    let answer = store.beat(user.id, beat, Date.now());
    // A long poll: nothing to say yet, so wait for news (a command, a new
    // watcher) up to HOLD_MS. One held beat per device at most.
    if (beat.hold && answer.commands.length === 0 && !answer.want && !answer.yield) {
      await store.hold(user.id, beat.deviceId, HOLD_MS, req.signal);
      answer = store.answer(user.id, beat.deviceId, Date.now());
    }
    return Response.json(answer);
  } catch (e) {
    return remoteErrorResponse(e);
  }
});
