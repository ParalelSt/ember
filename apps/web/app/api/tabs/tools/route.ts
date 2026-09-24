import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { fromError } from '@/lib/upsertTrack';
import { generatorStatus } from '@/lib/tabGenerate';
import { TOOLS_MISSING_CODE, TOOLS_MISSING_MESSAGE } from '@/lib/tabToolsText';

/** What this server can do for tabs beyond drawing them.
 *
 *  GET: { generate: { available, missing, code?, message? } }. The tab page
 *  greys out "Generate a tab" with the message when `available` is false:
 *  the optional Python tools (Basic Pitch, see SETUP.md) are not installed
 *  on this host. Nothing is installed from here. */
export const GET = withRequestLog('tabs/tools', async () => {
  try {
    await requireUser();
    const generate = await generatorStatus();
    return Response.json({
      generate: generate.available
        ? { available: true, missing: [] }
        : { available: false, missing: generate.missing, code: TOOLS_MISSING_CODE, message: TOOLS_MISSING_MESSAGE },
    });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
