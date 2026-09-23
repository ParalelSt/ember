import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { jsonError } from '@/lib/upsertTrack';
import { createAdminClient } from '@/lib/pocketbase/server';
import { serverLogger } from '@/lib/logger/server';
import { MAX_TRANSFER_ITEMS } from '@/lib/import/jobState';
import { createImportJob } from '@/lib/import/store';
import { kickImportRunner } from '@/lib/import/runnerInstance';
import { FLOW_ID_RE, takeFlow } from '@/lib/import/google/flows';
import { GOOGLE_MESSAGES } from '@/lib/import/sources/ytmusicLiked';
import { GOOGLE_LIKES_SOURCE_ID } from '@/lib/import/musicCheck';
import { withRequestLog } from '@/lib/logger/withRequestLog';

const CAP = MAX_TRANSFER_ITEMS.toLocaleString('en-GB');
const OVER_CAP_MESSAGE = `Ember can transfer up to ${CAP} songs at once, and your YouTube Music likes have more. Ember will take the newest ${CAP}.`;

/** Start: the songs a ready sign-in read become a `kind: 'liked'` transfer.
 *  YouTube Music already said which likes are songs, before the preview:
 *  songs are liked by the runner as they are (no search), uploads wait in
 *  the review list, and likes that are not music are only counted. The
 *  sign-in is gone afterwards (its tokens went when the likes were read). */
export const POST = withRequestLog(
  'import/liked/google/[flowId]/start',
  async (_req: NextRequest, ctx: RouteContext<'/api/import/liked/google/[flowId]/start'>) => {
    try {
      const { user } = await requireUser();
      const { flowId } = await ctx.params;
      const parsed = FLOW_ID_RE.test(flowId) ? takeFlow(user.id, flowId) : null;
      if (!parsed) return jsonError(GOOGLE_MESSAGES.gone, 404);

      const admin = await createAdminClient();
      const { job } = await createImportJob(admin, {
        userId: user.id,
        source: 'ytmusic',
        sourceId: GOOGLE_LIKES_SOURCE_ID,
        sourceUrl: '',
        name: parsed.label,
        coverUrl: null,
        kind: 'liked',
        order: parsed.order,
        items: parsed.items,
      });
      kickImportRunner();
      // `truncated` is news, not a failure: the transfer still runs.
      return Response.json(
        { job, playlistId: null, truncated: parsed.truncated, note: parsed.truncated ? OVER_CAP_MESSAGE : null },
        { status: 201 },
      );
    } catch (e) {
      if (e instanceof UnauthorizedError) return unauthorizedResponse();
      serverLogger.error('api', 'import/liked/google start failed', { status: (e as { status?: number })?.status });
      return jsonError('Ember could not start that transfer. Press Sign in with Google to try again.', 502);
    }
  },
);
