import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { MIME_BY_EXT } from '@/lib/uploads';

/** Serves an audio file from disk with Range support, so seeking works and
 *  the player can start before the whole file arrives. Shared by member
 *  uploads and the admin prank library. `headers` are added to every answer. */
export function serveFile(filePath: string, range: string | null, headers: Record<string, string> = {}): Response {
  const mime = MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const stat = fs.statSync(filePath);

  const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null;
  if (match && (match[1] || match[2])) {
    let start: number;
    let end: number;
    if (!match[1]) {
      // bytes=-N is the LAST N bytes, not the first ones.
      start = Math.max(0, stat.size - parseInt(match[2], 10));
      end = stat.size - 1;
    } else {
      start = parseInt(match[1], 10);
      // An end past the file is clamped to it (RFC 9110), not refused.
      end = Math.min(match[2] ? parseInt(match[2], 10) : stat.size - 1, stat.size - 1);
    }
    if (start >= stat.size || start > end) {
      return new Response('range not satisfiable', {
        status: 416,
        headers: { ...headers, 'Content-Range': `bytes */${stat.size}` },
      });
    }
    const stream = fs.createReadStream(filePath, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, {
      status: 206,
      headers: {
        ...headers,
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
      ...headers,
      'Content-Length': String(stat.size),
      'Content-Type': mime,
      'Accept-Ranges': 'bytes',
    },
  });
}
