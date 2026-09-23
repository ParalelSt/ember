import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { sameDoc, type ThemeDoc } from '@/lib/theme/model';
import { detach, docFromPreset, docFromSaved, parseSelection } from '@/lib/theme/saved';
import { openThemesRepo } from '@/lib/theme/themesRepo';
import { readActive, unreadableResponse, writeActive } from '@/lib/theme/serverActive';

/** The signed-in person's ACTIVE theme (users.theme), synced across devices
 *  and read by the root layout from the pb_auth cookie for first paint.
 *
 *  GET   -> the active ThemeDoc (Ember when never set). A doc that came
 *           from a saved theme is brought up to date on the way: the
 *           creator's edits are copied in, and if the original was deleted
 *           or unshared the link is dropped and the colours stay, so
 *           nobody's look breaks under them.
 *  PATCH -> { preset } or { themeId } (mine or shared with everyone),
 *           resolved to colours and stored; returns the stored doc.
 *
 *  The field is added on boot by pb_hooks/ensure_themes.pb.js. */

export const GET = withRequestLog('theme', async () => {
  try {
    const { pb, user } = await requireUser();
    const doc = await readActive(pb, user.id);
    if (!doc.themeId) return Response.json(doc satisfies ThemeDoc);

    const row = await (await openThemesRepo()).get(doc.themeId);
    const visible = row !== null && (row.owner === user.id || row.shared);
    const next = visible ? docFromSaved(row) : detach(doc);
    if (sameDoc(next, doc)) return Response.json(doc satisfies ThemeDoc);
    return Response.json((await writeActive(pb, user.id, next)) satisfies ThemeDoc);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

export const PATCH = withRequestLog('theme', async (request: NextRequest) => {
  try {
    const { pb, user } = await requireUser();
    const selection = parseSelection(await request.json().catch(() => null));
    if (!selection) {
      return Response.json({ error: 'Expected { preset } with a preset id, or { themeId }' }, { status: 400 });
    }

    let doc: ThemeDoc;
    if ('preset' in selection) {
      doc = docFromPreset(selection.preset);
    } else {
      const row = await (await openThemesRepo()).get(selection.themeId);
      if (!row || (row.owner !== user.id && !row.shared)) {
        return Response.json({ error: 'No such theme' }, { status: 404 });
      }
      const refused = unreadableResponse(row.inputs);
      if (refused) return refused;
      doc = docFromSaved(row);
    }
    return Response.json((await writeActive(pb, user.id, doc)) satisfies ThemeDoc);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
