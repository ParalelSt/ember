import type { NextRequest } from 'next/server';
import fs from 'node:fs/promises';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { rateLimitResponse } from '@/lib/rateLimit';
import { serverLogger } from '@/lib/logger/server';
import { withRequestLog } from '@/lib/logger/withRequestLog';
import { MIME_BY_EXT, newFilename } from '@/lib/uploads';
import {
  checkPrankDuration,
  checkPrankUpload,
  ensurePrankDir,
  measureDuration,
  PRANK_SOUND_KINDS,
  resolvePrankPath,
  toPrankSound,
} from '@/lib/pranks/media';
import { prankErrorResponse } from '@/lib/pranks/server';
import type { PrankSoundKind } from '@/lib/pranks/types';

const MAX_NAME = 120;

/** The prank library: every sound and prank song, newest first. Admins only;
 *  the collection's rules say the same at the /pb boundary. */
export const GET = withRequestLog('admin/pranks/sounds', async () => {
  try {
    await requireAdmin();
    const pb = await createAdminClient();
    const rows = await pb.collection('prank_sounds').getFullList({ sort: '-created' });
    return Response.json({ sounds: rows.map(toPrankSound) });
  } catch (e) {
    return prankErrorResponse(e);
  }
});

/** Adds a file to the library: multipart `file`, `kind` (sound | song) and
 *  an optional `name`. The bytes decide the format; sounds are 5 MB and 30 s
 *  at most, songs 50 MB. Stored under MUSIC_DIR/pranks with a random name. */
export const POST = withRequestLog('admin/pranks/sounds', async (req: NextRequest) => {
  let written: string | null = null;
  try {
    const { user } = await requireAdmin();
    const limited = rateLimitResponse(`prank-upload:${user.id}`, { windowMs: 60 * 60 * 1000, max: 30 });
    if (limited) return limited;

    const form = await req.formData().catch(() => null);
    const file = form?.get('file');
    if (!form || !(file instanceof File)) return Response.json({ error: 'No file uploaded' }, { status: 400 });
    const kind = String(form.get('kind') ?? '') as PrankSoundKind;
    if (!PRANK_SOUND_KINDS.includes(kind)) return Response.json({ error: 'Pick sound or song' }, { status: 400 });

    // Size first, before reading a byte of an oversized file into memory.
    const head = Buffer.from(await file.slice(0, 64).arrayBuffer());
    const check = checkPrankUpload(kind, file.size, head, file.type ?? '');
    if (!check.ok) return Response.json({ error: check.error }, { status: check.status });

    const buf = Buffer.from(await file.arrayBuffer());
    const mime = MIME_BY_EXT[check.ext] ?? '';
    const duration = await measureDuration(buf, mime);
    const tooLong = checkPrankDuration(kind, duration);
    if (tooLong && !tooLong.ok) return Response.json({ error: tooLong.error }, { status: tooLong.status });

    const name = String(form.get('name') ?? '').trim().slice(0, MAX_NAME)
      || file.name.replace(/\.[^.]+$/, '').trim().slice(0, MAX_NAME)
      || (kind === 'sound' ? 'Sound' : 'Song');

    ensurePrankDir();
    const filename = newFilename(check.ext);
    const full = resolvePrankPath(filename);
    if (!full) return Response.json({ error: 'Could not store the file' }, { status: 500 });
    await fs.writeFile(full, buf);
    written = full;

    const pb = await createAdminClient();
    const row = await pb.collection('prank_sounds').create({
      kind,
      name,
      filename,
      mime,
      duration_sec: duration === null ? 0 : Math.round(duration * 10) / 10,
      size_bytes: file.size,
      uploaded_by: user.id,
    });
    return Response.json({ sound: toPrankSound(row) }, { status: 201 });
  } catch (e) {
    // No record, no file: never leave an orphan in the library directory.
    if (written) {
      await fs.unlink(written).catch((err) => serverLogger.error('api', 'prank upload cleanup failed', {}, err));
    }
    return prankErrorResponse(e);
  }
});
