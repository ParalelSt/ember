import type { NextRequest } from 'next/server';
import fs from 'node:fs/promises';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { fromError, jsonError } from '@/lib/upsertTrack';
import { rateLimitResponse } from '@/lib/rateLimit';
import { serverLogger } from '@/lib/logger/server';
import {
  ALLOWED_TYPES,
  MAX_UPLOAD_BYTES,
  ensureUploadDir,
  mapUpload,
  newFilename,
  resolveUploadPath,
  sniffAudio,
} from '@/lib/uploads';

/** Custom song uploads.
 *
 *  GET  — every upload on the server, newest first (they're a shared library).
 *  POST — multipart: `file` plus title/artist/album/durationSec fields.
 *
 *  Writes go through an admin client because the collection's createRule is
 *  null: only this route may create rows, so the record can never disagree
 *  with what's actually on disk. */

const MAX_TEXT = 200;

export async function GET() {
  try {
    await requireUser();
    const pb = await createAdminClient();
    const rows = await pb.collection('uploads').getList(1, 200, { sort: '-created' });
    return Response.json({ tracks: rows.items.map(mapUpload) });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return fromError(e);
  }
}

export async function POST(request: NextRequest) {
  let writtenPath: string | null = null;
  try {
    const { user } = await requireUser();

    // Uploads are heavy (disk + bandwidth), so this is a real cap, not just
    // an anti-double-click guard: 10 songs an hour per person.
    const limited = rateLimitResponse(`upload:${user.id}`, { windowMs: 60 * 60 * 1000, max: 10 });
    if (limited) return limited;

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!form || !(file instanceof File)) return jsonError('No file uploaded', 400);

    if (file.size === 0) return jsonError('That file is empty', 400);
    if (file.size > MAX_UPLOAD_BYTES) {
      return jsonError(`File too large — the limit is ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)}MB`, 413);
    }

    const buf = Buffer.from(await file.arrayBuffer());
    // Trust the bytes over the browser's Content-Type, but accept either as
    // the source of the extension.
    const sniffed = sniffAudio(buf);
    const claimed = ALLOWED_TYPES[file.type?.toLowerCase() ?? ''];
    if (!sniffed) {
      return jsonError('That doesn’t look like an audio file', 415);
    }
    if (file.type && !claimed) {
      return jsonError(`Unsupported audio type: ${file.type}`, 415);
    }
    const ext = sniffed;

    const str = (key: string) => String(form.get(key) ?? '').slice(0, MAX_TEXT).trim();
    const title = str('title') || file.name.replace(/\.[^.]+$/, '').slice(0, MAX_TEXT) || 'Untitled';
    const artist = str('artist');
    const album = str('album');
    // Duration is measured in the browser (the server has no ffprobe
    // guarantee). Clamp it: it's only used for display and progress.
    const rawDuration = Number(form.get('durationSec') ?? 0);
    const durationSec = Number.isFinite(rawDuration) ? Math.max(0, Math.min(24 * 3600, Math.round(rawDuration))) : 0;

    ensureUploadDir();
    const filename = newFilename(ext);
    const full = resolveUploadPath(filename);
    if (!full) return jsonError('Could not store the file', 500);
    await fs.writeFile(full, buf);
    writtenPath = full;

    const pb = await createAdminClient();
    const created = await pb.collection('uploads').create({
      uploader: user.id,
      title,
      artist,
      album,
      duration_sec: durationSec,
      filename,
      mime: file.type || '',
      size_bytes: file.size,
    });

    return Response.json({ track: mapUpload(created) }, { status: 201 });
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    // Don't leave an orphaned file behind if the record didn't save.
    if (writtenPath) {
      await fs.unlink(writtenPath).catch((err) => {
        serverLogger.error('api', 'upload cleanup failed', { path: writtenPath }, err);
      });
    }
    return fromError(e);
  }
}
