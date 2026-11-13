import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchStream } from './api';
import { logger } from '@/lib/logger/client';
import type { SearchChunk } from '@/lib/search/types';

// The client half of the streamed search: lines become chunks as they
// arrive, a JSON answer (Trending, or an older server) becomes one legacy
// chunk, and failures throw like every other call.

vi.mock('@/lib/logger/client', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

const track = { id: 'youtube:a', source: 'youtube', sourceId: 'a', title: 'A', artist: 'B' };

/** A streamed response whose body arrives in the given pieces. */
function ndjson(pieces: string[]) {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of pieces) controller.enqueue(encoder.encode(p));
      controller.close();
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' } });
}

async function collect(it: AsyncGenerator<SearchChunk>) {
  const out: SearchChunk[] = [];
  for await (const c of it) out.push(c);
  return out;
}

beforeEach(() => {
  vi.mocked(logger.error).mockClear();
  vi.mocked(logger.warn).mockClear();
  vi.unstubAllGlobals();
});

describe('searchStream', () => {
  it('asks the streamed route with the clipped query', async () => {
    const fetch = vi.fn<(url: string) => Promise<Response>>(async () => ndjson(['{"type":"done"}\n']));
    vi.stubGlobal('fetch', fetch);
    await collect(searchStream('  daft punk  '));
    expect(fetch.mock.calls[0][0]).toBe('/api/search?q=daft%20punk&stream=1');
  });

  it('yields each line as a chunk, even when a line is split across reads', async () => {
    const line = JSON.stringify({ type: 'songs', tracks: [track] });
    vi.stubGlobal('fetch', vi.fn(async () => ndjson([
      '{"type":"uploads","tracks":[]}\n' + line.slice(0, 7),
      `${line.slice(7)}\n{"type":"done"}\n`,
    ])));
    const chunks = await collect(searchStream('a'));
    expect(chunks.map((c) => c.type)).toEqual(['uploads', 'songs', 'done']);
    expect(chunks[1]).toEqual({ type: 'songs', tracks: [track] });
  });

  it('hands over the first chunk before the rest has arrived', async () => {
    let push!: (s: string) => void;
    let end!: () => void;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (s) => controller.enqueue(encoder.encode(s));
        end = () => controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'application/x-ndjson' } })));
    const it = searchStream('a');
    push('{"type":"uploads","tracks":[]}\n');
    expect((await it.next()).value).toEqual({ type: 'uploads', tracks: [] });
    push('{"type":"done"}\n');
    end();
    expect((await it.next()).value).toEqual({ type: 'done' });
    expect((await it.next()).done).toBe(true);
  });

  it('a JSON answer (Trending, an older server) is one legacy chunk', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ tracks: [track] })));
    expect(await collect(searchStream(''))).toEqual([{ type: 'legacy', tracks: [track] }]);
  });

  it('a rate limit throws its status and is only a warning', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'Slow down' }, { status: 429 })));
    await expect(collect(searchStream('a'))).rejects.toMatchObject({ status: 429, message: 'Slow down' });
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('a dropped connection is tried again before anything arrived', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(ndjson(['{"type":"done"}\n']));
    vi.stubGlobal('fetch', fetch);
    const done = collect(searchStream('a'));
    await vi.runAllTimersAsync();
    expect(await done).toEqual([{ type: 'done' }]);
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('an abort is not retried and not logged as a fault', async () => {
    const controller = new AbortController();
    controller.abort();
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const fetch = vi.fn(async () => { throw abort; });
    vi.stubGlobal('fetch', fetch);
    await expect(collect(searchStream('a', controller.signal))).rejects.toBe(abort);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
