// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { withLock } from './keyedLock';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('withLock', () => {
  it('runs calls with one key in order, and others alongside', async () => {
    const order: string[] = [];
    let release!: () => void;
    const first = withLock('a', () => new Promise<void>((r) => (release = r)).then(() => void order.push('a1')));
    const second = withLock('a', async () => void order.push('a2'));
    const other = withLock('b', async () => void order.push('b1'));
    await other;
    await flush();
    expect(order).toEqual(['b1']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['b1', 'a1', 'a2']);
  });

  it('holds across route bundles: an approve in one route and a deny in another never both act', async () => {
    // Each QR route (approve, deny, status) bundles its own copy of this
    // module in a production build (see lib/sources/failureMemo): a lock
    // map per copy serialized nothing between them.
    const order: string[] = [];
    let release!: () => void;
    const approve = withLock('req1', () => new Promise<void>((r) => (release = r)).then(() => void order.push('approve')));
    vi.resetModules();
    const other = await import('./keyedLock');
    const deny = other.withLock('req1', async () => void order.push('deny'));
    await flush();
    expect(order).toEqual([]);
    release();
    await Promise.all([approve, deny]);
    expect(order).toEqual(['approve', 'deny']);
  });
});
