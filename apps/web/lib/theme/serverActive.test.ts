// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
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

describe('withThemeLock across route bundles', () => {
  it('a switch in one route waits for an edit-save in another', async () => {
    // PATCH /api/theme and the /api/themes routes each bundle their own copy
    // of this module in a production build (see lib/sources/failureMemo):
    // a lock map per copy serialized nothing between them (bughunt N2).
    const order: string[] = [];
    let release!: () => void;
    const save = withThemeLock('u5', () => new Promise<void>((r) => (release = r)).then(() => void order.push('edit-save')));
    vi.resetModules();
    const other = await import('./serverActive');
    const change = other.withThemeLock('u5', async () => void order.push('switch'));
    await flush();
    expect(order).toEqual([]);
    release();
    await Promise.all([save, change]);
    expect(order).toEqual(['edit-save', 'switch']);
  });
});
