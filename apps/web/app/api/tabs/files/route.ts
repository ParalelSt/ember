import type { NextRequest } from 'next/server';
import fs from 'node:fs/promises';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { rateLimitResponse } from '@/lib/rateLimit';
import { serverLogger } from '@/lib/logger/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import {
  MAX_TAB_BYTES,
  ensureTabDir,
  mapTab,
  newTabFilename,
  resolveTabPath,
  sniffTab,
  tabMatchesTrack,
} from '@/lib/tabs';

/** A member's Guitar Pro tab files.
 *
 *  GET  — your own tabs, newest first. `?title=&artist=` narrows to the ones
 *         that plausibly belong to that song, which is what the player asks
 *         for when the tab panel opens.
 *  POST — multipart: `file`, plus optional title/artist/instrument/trackId.
 *
 *  Tabs are per-member, not a shared library: the file is that person's own
 *  copy. Writes go through the admin client because the collection's
 *  createRule is null. */

const MAX_TEXT = 200;

export const GET = withRequestLog('tabs/files', async (request: NextRequest) => {
  try {
    const { user } = await requireUser();
    const pb = await createAdminClient();
    const rows = await pb.collection('tabs').getList(1, 200, {
      filter: `user = "${user.id}"`,
      sort: '-created',
    });

    const title = request.nextUrl.searchParams.get('title') ?? '';
    const artist = request.nextUrl.searchParams.get('artist') ?? '';
    const items = title || artist
      ? rows.items.filter((r) => tabMatchesTrack(r as { title?: string; artist?: string }, { title, artist }))
      : rows.items;

    return Response.json({ tabs: items.map(mapTab) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
});

export const POST = withRequestLog('tabs/files', async (request: NextRequest) => {
  let writtenPath: string | null = null;
  try {
    const { user } = await requireUser();

    const limited = rateLimitResponse(`tab-upload:${user.id}`, { windowMs: 60 * 60 * 1000, max: 40 });
    if (limited) return limited;

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!form || !(file instanceof File)) return jsonError('No file uploaded', 400);

    if (file.size === 0) return jsonError('That file is empty', 400);
    if (file.size > MAX_TAB_BYTES) {
      return jsonError(`File too large — the limit is ${Math.round(MAX_TAB_BYTES / 1024 / 1024)}MB`, 413);
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const ext = sniffTab(buf);
    if (!ext) return jsonError('That doesn’t look like a Guitar Pro file', 415);

    const str = (key: string) => String(form.get(key) ?? '').slice(0, MAX_TEXT).trim();
    const title = str('title') || file.name.replace(/\.[^.]+$/, '').slice(0, MAX_TEXT) || 'Untitled';

    ensureTabDir();
    const filename = newTabFilename(ext);
    const full = resolveTabPath(filename);
    if (!full) return jsonError('Could not store the file', 500);
    await fs.writeFile(full, buf);
    writtenPath = full;

    const pb = await createAdminClient();
    const created = await pb.collection('tabs').create({
      user: user.id,
      track: str('trackId') || null,
      title,
      artist: str('artist'),
      instrument: str('instrument').slice(0, 60),
      file: filename,
      size_bytes: file.size,
    });

    return Response.json({ tab: mapTab(created) }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    if (writtenPath) {
      await fs.unlink(writtenPath).catch((err) => {
        serverLogger.error('api', 'tab cleanup failed', { path: writtenPath }, err);
      });
    }
    return fromError(e);
  }
});
