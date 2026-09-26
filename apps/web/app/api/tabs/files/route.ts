import type { NextRequest } from 'next/server';
import fs from 'node:fs/promises';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { rateLimitResponse } from '@/lib/rateLimit';
import { serverLogger } from '@/lib/logger/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { MAX_TAB_BYTES, ensureTabDir, newTabFilename, resolveTabPath, sniffTab } from '@/lib/tabs';
import { addedByNames, findTabs, formatOf, mapTab, songKeyOf } from '@/lib/tabStore';

/** Tab files people add (Guitar Pro, MusicXML).
 *
 *  GET  : every file tab you can see (shared ones and your own), files
 *         first, newest first. `?title=&artist=` (and optionally `trackId=`)
 *         narrows to the ones for that song, by song_key, which is what the
 *         tab page asks for. `kind=all` adds pasted tabs and tabs found
 *         online (the whole source chain the page picks from); the default
 *         is files only. Generated tabs from older servers are never listed.
 *  POST : multipart `file`, plus optional title/artist/instrument/trackId.
 *         The new tab is shared with everyone on the server; its uploader
 *         (and admins) can delete it.
 *
 *  Writes go through the admin client because the collection's createRule
 *  is null. Visibility is enforced in lib/tabStore.ts. */

const MAX_TEXT = 200;

export const GET = withRequestLog('tabs/files', async (request: NextRequest) => {
  try {
    const { user } = await requireUser();
    const pb = await createAdminClient();
    const params = request.nextUrl.searchParams;
    const rows = await findTabs(
      pb,
      user,
      {
        title: params.get('title') ?? '',
        artist: params.get('artist') ?? '',
        trackId: params.get('trackId') ?? '',
      },
      params.get('kind') === 'all' ? {} : { kind: 'file' },
    );
    const names = await addedByNames(pb, rows);
    return Response.json({ tabs: rows.map((r) => mapTab(r, user, names.get(String(r.user ?? '')) ?? null)) });
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
      return jsonError(`File too large, the limit is ${Math.round(MAX_TAB_BYTES / 1024 / 1024)}MB`, 413);
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const ext = sniffTab(buf);
    if (!ext) return jsonError('That doesn’t look like a Guitar Pro file', 415);

    const str = (key: string) => String(form.get(key) ?? '').slice(0, MAX_TEXT).trim();
    const title = str('title') || file.name.replace(/\.[^.]+$/, '').slice(0, MAX_TEXT) || 'Untitled';
    const artist = str('artist');
    const trackId = str('trackId').slice(0, 80);

    ensureTabDir();
    const filename = newTabFilename(ext);
    const full = resolveTabPath(filename);
    if (!full) return jsonError('Could not store the file', 500);
    await fs.writeFile(full, buf);
    writtenPath = full;

    const pb = await createAdminClient();
    const created = await pb.collection('tabs').create({
      user: user.id,
      title,
      artist,
      instrument: str('instrument').slice(0, 60),
      file: filename,
      size_bytes: file.size,
      kind: 'file',
      format: formatOf(filename),
      shared: true,
      song_key: songKeyOf({ title, artist }),
      track_key: trackId,
      offset_ms: 0,
    });

    return Response.json({ tab: mapTab(created, user) }, { status: 201 });
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
