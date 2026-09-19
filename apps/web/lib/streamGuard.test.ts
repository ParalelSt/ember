import { describe, it, expect } from 'vitest';
import { withStallTimeout, StreamStalledError } from './streamGuard';

/** A body that yields `chunks` with `gapMs` between them, then ends (or, with
 *  `hangAfter`, simply stops sending and never ends). */
function body(chunks: string[], gapMs: number, hangAfter = false): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i >= chunks.length) {
        if (hangAfter) return new Promise<void>(() => {}); // never settles: the stall
        controller.close();
        return;
      }
      const chunk = chunks[i++];
      await new Promise((r) => setTimeout(r, gapMs));
      controller.enqueue(enc.encode(chunk));
    },
  });
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let out = '';
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value);
  }
  return out;
}

describe('withStallTimeout', () => {
  it('passes a healthy body through untouched', async () => {
    const guarded = withStallTimeout(body(['abc', 'def'], 1), 200);
    expect(await drain(guarded!)).toBe('abcdef');
  });

  it('leaves a slow but progressing body alone', async () => {
    // Four gaps of 40ms each, well over the 60ms budget in total: only the gap
    // BETWEEN chunks counts, or throttled YouTube streams would be killed.
    const guarded = withStallTimeout(body(['a', 'b', 'c', 'd'], 40), 120);
    expect(await drain(guarded!)).toBe('abcd');
  });

  it('errors instead of hanging when the upstream goes quiet', async () => {
    const stalls: StreamStalledError[] = [];
    const guarded = withStallTimeout(body(['abc'], 1, true), 120, (e) => stalls.push(e));
    const started = Date.now();
    await expect(drain(guarded!)).rejects.toBeInstanceOf(StreamStalledError);
    // Fails on the clock, not at the end of time.
    expect(Date.now() - started).toBeLessThan(1000);
    expect(stalls).toHaveLength(1);
    expect(stalls[0].message).toMatch(/stopped sending/);
  });

  it('keeps a bodyless response bodyless', () => {
    expect(withStallTimeout(null)).toBeNull();
  });
});
