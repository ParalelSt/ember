import type { NextRequest } from 'next/server';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { fromError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { cleanThemeName, isPresetId, isRecordId, validateInputs, THEME_NAME_MAX } from '@/lib/theme/model';
import { detach, docFromSaved, type SavedTheme } from '@/lib/theme/saved';
import { openThemesRepo, toSaved, type ThemeRow, type ThemeRowPatch, type ThemesRepo } from '@/lib/theme/themesRepo';
import { readActive, unreadableResponse, writeActiveIfCurrent } from '@/lib/theme/serverActive';

/** One of my saved themes. Only its creator changes it.
 *
 *  PATCH  -> any of { name, base, inputs, shared }: rename, edit the
 *            colours, share with everyone or stop sharing. When it is my
 *            active theme, the active copy follows and comes back as
 *            `active` so the client can refresh its cookie.
 *  DELETE -> gone. If it was my active theme I keep its colours (the link
 *            is dropped, `active` returned). Anyone else using it keeps
 *            their copy too: GET /api/theme detaches theirs on next load. */

type Ctx = RouteContext<'/api/themes/[id]'>;

/** My row, or the response that says why not: 404 for missing (or someone
 *  else's private theme, which I cannot see), 403 for someone else's
 *  shared theme. */
async function ownRow(repo: ThemesRepo, id: string, me: string): Promise<ThemeRow | Response> {
  const row = isRecordId(id) ? await repo.get(id) : null;
  if (!row || (row.owner !== me && !row.shared)) return Response.json({ error: 'No such theme' }, { status: 404 });
  if (row.owner !== me) return Response.json({ error: 'Only its creator can change this theme' }, { status: 403 });
  return row;
}

const bad = (error: string) => Response.json({ error }, { status: 400 });

export const PATCH = withRequestLog('themes/[id]', async (request: NextRequest, ctx: Ctx) => {
  try {
    const { pb, user } = await requireUser();
    const { id } = await ctx.params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('Expected a JSON object');

    const patch: ThemeRowPatch = {};
    if ('name' in body) {
      const name = cleanThemeName(body.name);
      if (!name) return bad(`name: 1 to ${THEME_NAME_MAX} characters`);
      patch.name = name;
    }
    if ('base' in body) {
      if (!isPresetId(body.base)) return bad('base: unknown preset');
      patch.base = body.base;
    }
    if ('inputs' in body) {
      const inputs = validateInputs(body.inputs);
      if (!inputs.ok) return bad(inputs.error);
      const refused = unreadableResponse(inputs.inputs);
      if (refused) return refused;
      patch.inputs = inputs.inputs;
    }
    if ('shared' in body) {
      if (typeof body.shared !== 'boolean') return bad('shared: expected true or false');
      patch.shared = body.shared;
    }
    if (Object.keys(patch).length === 0) return bad('Expected name, base, inputs or shared');

    const repo = await openThemesRepo();
    const row = await ownRow(repo, id, user.id);
    if (row instanceof Response) return row;
    const updated = await repo.update(row.id, patch);

    const active = await writeActiveIfCurrent(pb, user.id, updated.id, docFromSaved(updated));
    return Response.json({ theme: toSaved(updated) satisfies SavedTheme, ...(active ? { active } : {}) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

export const DELETE = withRequestLog('themes/[id]', async (_request: NextRequest, ctx: Ctx) => {
  try {
    const { pb, user } = await requireUser();
    const { id } = await ctx.params;
    const repo = await openThemesRepo();
    const row = await ownRow(repo, id, user.id);
    if (row instanceof Response) return row;
    await repo.remove(row.id);

    const current = await readActive(pb, user.id);
    const active = current.themeId === row.id ? await writeActiveIfCurrent(pb, user.id, row.id, detach(current)) : undefined;
    return Response.json({ ok: true, ...(active ? { active } : {}) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});
