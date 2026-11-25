import { describe, expect, it, vi } from 'vitest';
import { createTtlMemo } from './ttlMemo';

describe('createTtlMemo', () => {
  it('answers a repeat from memory without loading again', async () => {
    const memo = createTtlMemo<number>({ ttlMs: 1000, max: 5 });
    const load = vi.fn().mockResolvedValue(7);
    expect(await memo.get('a', load)).toBe(7);
    expect(await memo.get('a', load)).toBe(7);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shares one load between concurrent askers', async () => {
    const memo = createTtlMemo<number>({ ttlMs: 1000, max: 5 });
    let release!: (v: number) => void;
    const load = vi.fn(() => new Promise<number>((r) => { release = r; }));
    const all = Promise.all([memo.get('a', load), memo.get('a', load), memo.get('a', load)]);
    release(3);
    expect(await all).toEqual([3, 3, 3]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('loads again once the answer is older than the ttl', async () => {
    let t = 0;
    const memo = createTtlMemo<number>({ ttlMs: 1000, max: 5, now: () => t });
    const load = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    expect(await memo.get('a', load)).toBe(1);
    t = 1001;
    expect(await memo.get('a', load)).toBe(2);
  });

  it('never keeps a failure, and everyone waiting sees it', async () => {
    const memo = createTtlMemo<number>({ ttlMs: 1000, max: 5 });
    const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(9);
    const both = await Promise.allSettled([memo.get('a', load), memo.get('a', load)]);
    expect(both.map((r) => r.status)).toEqual(['rejected', 'rejected']);
    expect(load).toHaveBeenCalledTimes(1);
    expect(await memo.get('a', load)).toBe(9);
  });

  it('does not keep an answer keep() refuses', async () => {
    const memo = createTtlMemo<number[]>({ ttlMs: 1000, max: 5, keep: (v) => v.length > 0 });
    const load = vi.fn().mockResolvedValue([]);
    await memo.get('a', load);
    await memo.get('a', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('drops the oldest entry past max', async () => {
    const memo = createTtlMemo<number>({ ttlMs: 1000, max: 2 });
    for (const k of ['a', 'b', 'c']) await memo.get(k, async () => 1);
    expect(memo.size()).toBe(2);
    const load = vi.fn().mockResolvedValue(1);
    await memo.get('a', load);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
