// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { themeLocksHeld, withThemeLock } from './serverActive';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('withThemeLock', () => {
  it('runs one user\'s calls in order', async () => {
    const order: string[] = [];
    let release!: () => void;
    const first = withThemeLock('u1', () => new Promise<void>((r) => (release = r)).then(() => void order.push('first')));
    const second = withThemeLock('u1', async () => void order.push('second'));
    await flush();
    expect(order).toEqual([]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
  });

  it('forgets a user once their last call settles, so the map does not grow forever', async () => {
    await withThemeLock('u2', async () => 1);
    await expect(withThemeLock('u3', async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await flush();
    expect(themeLocksHeld()).toBe(0);
  });

  it('keeps the entry while a later call is still queued', async () => {
    let release!: () => void;
    const a = withThemeLock('u4', async () => 1);
    const b = withThemeLock('u4', () => new Promise<void>((r) => (release = r)));
    await a;
    await flush();
    expect(themeLocksHeld()).toBe(1);
    release();
    await b;
    await flush();
    expect(themeLocksHeld()).toBe(0);
  });
});
