import type { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { requireUser, UnauthorizedError, unauthorizedResponse } from '@/lib/auth';
import { createAdminClient } from '@/lib/pocketbase/server';
import { MIME_BY_EXT, resolveUploadPath } from '@/lib/uploads';

/** Serves a member-uploaded song with Range support, so seeking works and
 *  the browser can start playing before the whole file arrives. */
function serveFile(filePath: string, range: string | null): Response {
  const mime = MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const stat = fs.statSync(filePath);

  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (match) {
    const start = match[1] ? parseInt(match[1], 10) : 0;
    const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
    if (start >= stat.size || end >= stat.size || start > end) {
      return new Response('range not satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${stat.size}` },
      });
    }
    const stream = fs.createReadStream(filePath, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(end - start + 1),
        'Content-Type': mime,
      },
    });
  }

  const stream = fs.createReadStream(filePath);
  return new Response(Readable.toWeb(stream) as ReadableStream, {
    status: 200,
    headers: {
      'Content-Length': String(stat.size),
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
    },
  });
}

export async function GET(request: NextRequest, ctx: RouteContext<'/api/uploads/[id]/stream'>) {
  try {
    await requireUser();
    const { id } = await ctx.params;

    const pb = await createAdminClient();
    const row = await pb.collection('uploads').getOne(id).catch(() => null);
    if (!row) return new Response('not found', { status: 404 });

    // The filename comes from our own record, but resolve defensively anyway —
    // this is the one place a bad value would read an arbitrary file.
    const full = resolveUploadPath(String(row.filename ?? ''));
    if (!full || !fs.existsSync(full)) return new Response('file missing', { status: 404 });

    return serveFile(full, request.headers.get('range'));
  } catch (e) {
    if (e instanceof UnauthorizedError) return unauthorizedResponse();
    return new Response('stream failed', { status: 500 });
  }
}
