import type { NextRequest } from 'next/server';
import fs from 'node:fs/promises';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { rateLimitResponse } from '@/lib/rateLimit';
import { serverLogger } from '@/lib/logger/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { ensureTabDir, newTabFilename, resolveTabPath } from '@/lib/tabs';
import { mapTab, songKeyOf } from '@/lib/tabStore';
import { MAX_TAB_TEXT_BYTES, MAX_TEMPO, MIN_TEMPO, parseTabText } from '@/lib/tabText';

/** A text tab someone pasted (docs/tab-sources.md section 5).
 *
 *  POST JSON { text, title, artist, trackId, tempo?, tuning? }. The text is
 *  parsed here with the same module the paste dialog previews with
 *  (lib/tabText.ts), so the saved tab is the preview. Stored like a file:
 *  one `tabs` row (kind "pasted", format alphatex, shared, `user` = who
 *  pasted) and two files side by side in MUSIC_DIR/tabs, `<stem>.alphatex`
 *  (served by the unchanged download route) and `<stem>.txt` (the paste,
 *  kept for a later re-parse). Deleting goes through /api/tabs/files/[id]:
 *  whoever pasted it, or an admin, and both files go.
 *
 *  The listener copies the text themselves; tabs Ember finds online on its
 *  own go through /api/tabs/online (lib/tabFetch) and the same parser. */

const MAX_TEXT = 200;
/** JSON quoting and the other fields on top of the tab text itself. */
const MAX_BODY_BYTES = MAX_TAB_TEXT_BYTES * 2 + 8 * 1024;

const tooBig = () => jsonError(`That tab is too long, the limit is ${MAX_TAB_TEXT_BYTES / 1024} KB`, 413);

export const POST = withRequestLog('tabs/text', async (request: NextRequest) => {
  const written: string[] = [];
  try {
    const { user } = await requireUser();

    // Same bucket as adding a file: pasting is adding a tab too.
    const limited = rateLimitResponse(`tab-upload:${user.id}`, { windowMs: 60 * 60 * 1000, max: 40 });
    if (limited) return limited;

    if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) return tooBig();
    const raw = await request.text();
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) return tooBig();
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return jsonError('Send the tab as JSON', 400);
    }
    if (!body || typeof body !== 'object') return jsonError('Send the tab as JSON', 400);

    const text = body.text;
    if (typeof text !== 'string' || !text.trim()) return jsonError('Paste a tab first', 400);
    if (Buffer.byteLength(text) > MAX_TAB_TEXT_BYTES) return tooBig();

    const str = (key: string, max = MAX_TEXT) => (typeof body[key] === 'string' ? (body[key] as string).trim().slice(0, max) : '');
    const title = str('title') || 'Untitled';
    const artist = str('artist');
    const trackId = str('trackId', 80);

    let tempo: number | null = null;
    if (body.tempo !== undefined && body.tempo !== null) {
      if (typeof body.tempo !== 'number' || !Number.isFinite(body.tempo) || body.tempo < MIN_TEMPO || body.tempo > MAX_TEMPO) {
        return jsonError(`tempo must be a number between ${MIN_TEMPO} and ${MAX_TEMPO}`, 400);
      }
      tempo = body.tempo;
    }
    let tuning: string | null = null;
    if (body.tuning !== undefined && body.tuning !== null) {
      if (typeof body.tuning !== 'string' || body.tuning.length > 100) return jsonError('tuning must be text like "E4 B3 G3 D3 A2 E2"', 400);
      tuning = body.tuning;
    }

    const parsed = parseTabText(text, { title, artist, tempo, tuning });
    if (!parsed.ok) return Response.json({ error: parsed.error, report: parsed.report }, { status: 422 });

    ensureTabDir();
    const filename = newTabFilename('.alphatex');
    const stem = filename.slice(0, -'.alphatex'.length);
    const texPath = resolveTabPath(filename);
    const txtPath = resolveTabPath(`${stem}.txt`);
    if (!texPath || !txtPath) return jsonError('Could not store the tab', 500);
    await fs.writeFile(texPath, parsed.alphaTex, 'utf8');
    written.push(texPath);
    await fs.writeFile(txtPath, text, 'utf8');
    written.push(txtPath);

    const pb = await createAdminClient();
    const created = await pb.collection('tabs').create({
      user: user.id,
      title,
      artist,
      instrument: parsed.report.instrument === 'bass' ? 'Bass' : 'Guitar',
      file: filename,
      size_bytes: Buffer.byteLength(text),
      kind: 'pasted',
      format: 'alphatex',
      shared: true,
      song_key: songKeyOf({ title, artist }),
      track_key: trackId,
      offset_ms: 0,
    });

    return Response.json({ tab: mapTab(created, user), report: parsed.report }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    for (const p of written) {
      await fs.unlink(p).catch((err) => {
        serverLogger.error('api', 'tab cleanup failed', { path: p }, err);
      });
    }
    return fromError(e);
  }
});
