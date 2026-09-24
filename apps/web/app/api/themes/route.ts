import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { cleanThemeName, isPresetId, isRecordId, validateInputs, THEME_NAME_MAX } from '@/lib/theme/model';
import { copyName, THEME_CAP, type SavedTheme, type ThemesList } from '@/lib/theme/saved';
import { openThemesRepo, toSaved, toShared, type NewThemeRow } from '@/lib/theme/themesRepo';
import { unreadableResponse } from '@/lib/theme/serverActive';

/** Saved themes (Settings > Appearance).
 *
 *  GET  -> { mine, shared, cap }: my saved themes, and everyone else's
 *          themes shared with everyone, each labelled with its creator.
 *  POST -> { name, base, inputs, shared? } creates one of mine, or
 *          { duplicateOf, name? } copies one of mine or a shared one
 *          ("Copy to my themes"; the copy starts unshared). 201 { theme }.
 *
 *  Refusals: 400 names the bad field, 409 at the cap of 20, 422 when a
 *  readability pair fails (with the findings). The `themes` collection
 *  (pb_hooks/ensure_themes.pb.js) takes writes from these routes only. */

const CAP_ERROR = `You can keep up to ${THEME_CAP} themes. Delete one to make room.`;

export const GET = withRequestLog('themes', async () => {
  try {
    const { user } = await requireUser();
    const repo = await openThemesRepo();
    const [mine, shared] = await Promise.all([repo.listMine(user.id), repo.listShared(user.id)]);
    return Response.json({ mine: mine.map(toSaved), shared: shared.map(toShared), cap: THEME_CAP } satisfies ThemesList);
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

const bad = (error: string) => Response.json({ error }, { status: 400 });

export const POST = withRequestLog('themes', async (request: NextRequest) => {
  try {
    const { user } = await requireUser();
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('Expected a JSON object');
    const repo = await openThemesRepo();

    let row: NewThemeRow;
    if ('duplicateOf' in body) {
      if (!isRecordId(body.duplicateOf)) return bad('duplicateOf: expected a theme id');
      const source = await repo.get(body.duplicateOf);
      if (!source || (source.owner !== user.id && !source.shared)) {
        return Response.json({ error: 'No such theme' }, { status: 404 });
      }
      const name = body.name === undefined ? copyName(source.name) : cleanThemeName(body.name);
      if (!name) return bad(`name: 1 to ${THEME_NAME_MAX} characters`);
      row = { owner: user.id, name, base: source.base, inputs: source.inputs, shared: false };
    } else {
      const name = cleanThemeName(body.name);
      if (!name) return bad(`name: 1 to ${THEME_NAME_MAX} characters`);
      if (!isPresetId(body.base)) return bad('base: unknown preset');
      const inputs = validateInputs(body.inputs);
      if (!inputs.ok) return bad(inputs.error);
      if (body.shared !== undefined && typeof body.shared !== 'boolean') return bad('shared: expected true or false');
      row = { owner: user.id, name, base: body.base, inputs: inputs.inputs, shared: body.shared === true };
    }

    const refused = unreadableResponse(row.inputs);
    if (refused) return refused;
    if ((await repo.countMine(user.id)) >= THEME_CAP) {
      return Response.json({ error: CAP_ERROR }, { status: 409 });
    }
    const created = await repo.create(row);
    return Response.json({ theme: toSaved(created) satisfies SavedTheme }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
