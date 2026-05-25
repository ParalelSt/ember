import type { NextRequest } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { ensureDownloaded, findCachedFile, resolveStreamUrl } from '@/lib/sources/youtube';
import { fromError } from '@/lib/upsertTrack';

const MIME_BY_EXT: Record<string, string> = {
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.webm': 'audio/webm',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
};

function streamMode(): 'cache' | 'proxy' {
  const m = (process.env.STREAM_MODE ?? 'proxy').toLowerCase();
  return m === 'cache' ? 'cache' : 'proxy';
}

function serveFile(filePath: string, range: string | null): Response {
  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
  const stat = fs.statSync(filePath);

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? parseInt(match[2], 10) : stat.size - 1;
      const chunk = end - start + 1;
      const stream = fs.createReadStream(filePath, { start, end });
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(chunk),
          'Content-Type': mime,
        },
      });
    }
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

export async function GET(request: NextRequest, ctx: RouteContext<'/api/youtube/stream/[videoId]'>) {
  const { videoId } = await ctx.params;
  const range = request.headers.get('range');
  try {
    const cached = findCachedFile(videoId);
    if (cached) return serveFile(cached, range);

    if (streamMode() === 'cache') {
      const filePath = await ensureDownloaded(videoId);
      return serveFile(filePath, range);
    }

    // Proxy mode: fetch upstream with same Range and pipe through.
    const info = await resolveStreamUrl(videoId);
    const upstreamHeaders: Record<string, string> = { 'User-Agent': 'Mozilla/5.0' };
    if (range) upstreamHeaders.Range = range;

    const upstream = await fetch(info.url, { headers: upstreamHeaders });
    const respHeaders = new Headers();
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified']) {
      const v = upstream.headers.get(h);
      if (v) respHeaders.set(h, v);
    }
    if (!respHeaders.has('content-type')) {
      const fallback = info.ext === 'm4a' ? 'audio/mp4' : info.ext === 'webm' ? 'audio/webm' : 'application/octet-stream';
      respHeaders.set('content-type', fallback);
    }
    return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
  } catch (e) {
    return fromError(e);
  }
}
