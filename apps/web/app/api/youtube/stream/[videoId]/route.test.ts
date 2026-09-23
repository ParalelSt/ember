import { describe, expect, it, vi, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const file = path.join(os.tmpdir(), 'stream-range-AAAAAAAAAAA.m4a');
beforeAll(() => { fs.writeFileSync(file, Buffer.alloc(1000, 7)); });

vi.mock('@/lib/logger/withRequestLog', () => ({ withRequestLog: (_n: string, h: unknown) => h }));
vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/streamCache', () => ({ queueCacheWarm: vi.fn() }));
vi.mock('@/lib/trackAvailability', () => ({
  clearTrackUnavailable: vi.fn(), listUnavailableIds: async () => new Set(), markTrackUnavailable: vi.fn(),
}));
vi.mock('@/lib/upsertTrack', () => ({ fromError: (e: Error) => new Response(String(e?.message), { status: 500 }) }));
vi.mock('@/lib/sources/youtube', () => ({
  ensureDownloaded: vi.fn(), findCachedFile: () => file, hasCachedStreamUrl: () => false,
  invalidateStreamUrl: vi.fn(), isDownloading: () => false, isUnavailableError: () => false, resolveStreamUrl: vi.fn(),
}));

import { GET } from './route';

async function get(range: string | null) {
  const headers = range ? new Headers({ range }) : new Headers();
  const req = { headers, nextUrl: new URL('http://x/api/youtube/stream/AAAAAAAAAAA') };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: Response = await (GET as any)(req, { params: Promise.resolve({ videoId: 'AAAAAAAAAAA' }) });
  const buf = await res.arrayBuffer();
  return { status: res.status, cr: res.headers.get('content-range'), cl: res.headers.get('content-length'), bodyLen: buf.byteLength };
}

describe('stream route byte ranges (1000-byte file)', () => {
  it('suffix range bytes=-100 returns the LAST 100 bytes', async () => {
    const r = await get('bytes=-100');
    expect(r.status).toBe(206);
    expect(r.cr).toBe('bytes 900-999/1000');
    expect(r.cl).toBe('100');
    expect(r.bodyLen).toBe(100);
  });

  it('range past EOF answers 416, not 500', async () => {
    const r = await get('bytes=5000-');
    expect(r.status).toBe(416);
    expect(r.cr).toBe('bytes */1000');
  });

  it('end beyond size is clamped, with a Content-Length that matches', async () => {
    const r = await get('bytes=0-4999');
    expect(r.status).toBe(206);
    expect(r.cr).toBe('bytes 0-999/1000');
    expect(r.cl).toBe(String(r.bodyLen));
    expect(r.bodyLen).toBe(1000);
  });

  it('a normal mid-file range is unaffected', async () => {
    const r = await get('bytes=100-199');
    expect(r.status).toBe(206);
    expect(r.cr).toBe('bytes 100-199/1000');
    expect(r.cl).toBe('100');
    expect(r.bodyLen).toBe(100);
  });

  it('an open-ended range from a start point is unaffected', async () => {
    const r = await get('bytes=900-');
    expect(r.status).toBe(206);
    expect(r.cr).toBe('bytes 900-999/1000');
    expect(r.cl).toBe('100');
  });

  it('no range header returns the full file as a plain 200', async () => {
    const r = await get(null);
    expect(r.status).toBe(200);
    expect(r.cr).toBeNull();
    expect(r.cl).toBe('1000');
    expect(r.bodyLen).toBe(1000);
  });

  it('a range with neither end (bytes=-) is ignored and the full file is served', async () => {
    const r = await get('bytes=-');
    expect(r.status).toBe(200);
    expect(r.cl).toBe('1000');
    expect(r.bodyLen).toBe(1000);
  });
});
