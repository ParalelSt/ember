import type { NextRequest } from 'next/server';
import { requireUser } from '@/lib/auth';
import { rateLimitResponse } from '@/lib/rateLimit';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { parseCommand } from '@/lib/remote/parse';
import { REMOTE_LIMITS, readJson, remoteErrorResponse } from '@/lib/remote/server';
import { remoteStore } from '@/lib/remote/store';

/** A button pressed on one device for another of the same account: queued
 *  for the target's next beat. 409 when the target is not reachable. */
export const POST = withRequestLog('remote/command', async (req: NextRequest) => {
  try {
    const { user } = await requireUser();
    const limited = rateLimitResponse(`remote-command:${user.id}`, REMOTE_LIMITS.command);
    if (limited) return limited;
    const body = await readJson(req);
    if (body instanceof Response) return body;
    const parsed = parseCommand(body);
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: parsed.status });
    if (parsed.command.type === 'setQueue') {
      const tight = rateLimitResponse(`remote-setqueue:${user.id}`, REMOTE_LIMITS.setQueue);
      if (tight) return tight;
    }
    const r = remoteStore().command(user.id, parsed.target, parsed.from, parsed.command, Date.now());
    if (!r.ok) return Response.json({ error: r.error }, { status: r.status });
    return Response.json({ id: r.id }, { status: 202 });
  } catch (e) {
    return remoteErrorResponse(e);
  }
});
