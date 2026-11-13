// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES, readJson } from './server';

// A body is refused before it is read when it says it is too big, and cut
// off as soon as it turns out too big when it does not say.

const streamOf = (chunks: Uint8Array[], onPull?: () => void) => new ReadableStream<Uint8Array>({
  pull(controller) {
    onPull?.();
    const next = chunks.shift();
    if (next) controller.enqueue(next);
    else controller.close();
  },
}, { highWaterMark: 0 });
const post = (body: ReadableStream<Uint8Array> | string, headers: Record<string, string> = {}) =>
  new Request('http://t/x', { method: 'POST', body, headers, duplex: 'half' } as RequestInit);

describe('readJson', () => {
  it('reads JSON', async () => {
    expect(await readJson(post('{"a":1}'))).toEqual({ a: 1 });
    const bad = await readJson(post('{oops'));
    expect(bad instanceof Response && bad.status).toBe(400);
  });

  it('refuses a declared size over the limit without reading a byte', async () => {
    let pulled = 0;
    const res = await readJson(post(streamOf([new Uint8Array(10)], () => { pulled++; }), { 'content-length': String(MAX_BODY_BYTES + 1) }));
    expect(res instanceof Response && res.status).toBe(413);
    expect(pulled).toBe(0);
  });

  it('stops reading a body without a size once it passes the limit', async () => {
    const chunk = new Uint8Array(64 * 1024).fill(32);
    const chunks = Array.from({ length: 64 }, () => chunk);
    let pulled = 0;
    const res = await readJson(post(streamOf(chunks, () => { pulled++; })));
    expect(res instanceof Response && res.status).toBe(413);
    expect(pulled).toBeLessThan(64);
  });
});
