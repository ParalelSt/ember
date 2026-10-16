import type { NextRequest } from 'next/server';
import { ForbiddenError, forbiddenResponse, requireAdmin, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { artistKey } from '@/lib/genres/artistKey';
import { manualOverride, type OverrideBody } from '@/lib/genres/override';
import { pbGenreStore } from '@/lib/genres/store';

type Ctx = { params: Promise<{ key: string }> };

/** An artist's genre row (admin only): `{ artist }`, null when Ember has
 *  never looked at them. */
export const GET = withRequestLog('admin/artist-genres/[key]', async (_request: NextRequest, ctx: Ctx) => {
  try {
    await requireAdmin();
    const { key } = await ctx.params;
    const k = artistKey(decodeURIComponent(key));
    const rows = await pbGenreStore(() => createAdminClient()).getMany([k]);
    return Response.json({ artist: rows.get(k) ?? null });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    if (e instanceof ForbiddenError) return forbiddenResponse();
    return fromError(e);
  }
});

/** Set an artist's family by hand (admin only): body `{ family, sub?, name? }`,
 *  family a taxonomy slug or null for "no family". Wins over every lookup;
 *  the next nightly build uses it. */
export const PATCH = withRequestLog('admin/artist-genres/[key]', async (request: NextRequest, ctx: Ctx) => {
  try {
    await requireAdmin();
    const { key } = await ctx.params;
    const body = (await request.json().catch(() => null)) as OverrideBody | null;
    const store = pbGenreStore(() => createAdminClient());
    const k = artistKey(decodeURIComponent(key));
    const existing = (await store.getMany([k])).get(k);
    const row = manualOverride(decodeURIComponent(key), body, existing, Date.now());
    if (typeof row === 'string') return jsonError(row, 400);
    await store.save(row);
    return Response.json({ artist: row });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    if (e instanceof ForbiddenError) return forbiddenResponse();
    return fromError(e);
  }
});
