import type { NextRequest } from 'next/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { parseUiMode, uiModeSetCookie } from '@/lib/uiMode';

/** POST /api/ui-mode { mode: 'new' | 'legacy' }: this device's look, as a
 *  cookie only the server sets (lib/uiMode). Settings' Classic look switch
 *  calls it, then reloads the page. Behind sign-in like any other API call;
 *  a signed-out device can still switch with `?ui=` on any page. A JSON body
 *  is required, so a cross-site form cannot flip it. */
export const POST = withRequestLog('ui-mode', async (req: NextRequest) => {
  const type = req.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) {
    return Response.json({ error: 'Send JSON' }, { status: 415 });
  }
  const body = (await req.json().catch(() => null)) as { mode?: unknown } | null;
  const mode = parseUiMode(body?.mode);
  if (!mode) return Response.json({ error: 'mode must be "new" or "legacy"' }, { status: 400 });
  const secure = req.headers.get('x-forwarded-proto') === 'https' || req.nextUrl?.protocol === 'https:';
  return Response.json(
    { ok: true, mode },
    { headers: { 'set-cookie': uiModeSetCookie(mode, secure), 'cache-control': 'no-store' } },
  );
});
