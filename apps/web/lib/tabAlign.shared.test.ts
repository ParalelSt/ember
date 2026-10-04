// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type PocketBase from 'pocketbase';
import type { RecordModel } from 'pocketbase';

vi.mock('@/lib/logger/server', () => ({ serverLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

/** A production build bundles every route on its own, so each route gets
 *  its own copy of a module's variables (lib/sources/failureMemo.ts, found
 *  live). The tab search route starts alignments and /api/tabs/align
 *  reports on them: both must see the same jobs, and Python jobs must wait
 *  for each other whichever route queued them. Two fresh module copies
 *  stand in for two routes. */
async function freshCopy<T>(path: string): Promise<T> {
  vi.resetModules();
  return (await import(path)) as T;
}

describe('state shared between route bundles', () => {
  it('a failure one route saw is the one the other route reports', async () => {
    type Mod = typeof import('./tabAlign');
    const searchRoute = await freshCopy<Mod>('./tabAlign');
    const alignRoute = await freshCopy<Mod>('./tabAlign');
    searchRoute.resetAlignment();
    const pb = { collection: () => ({ update: vi.fn(async () => ({})) }) } as unknown as PocketBase;
    // No file behind the row: the job fails at once.
    const row = { id: 'tabShared1', kind: 'fetched', file: '', track_key: 'upload:up1' } as unknown as RecordModel;
    await searchRoute.alignTab(pb, row);
    expect(alignRoute.alignmentStatus(row)).toMatchObject({ status: 'failed' });
    searchRoute.resetAlignment();
  });

  it('a Python job queued by one route waits for one queued by the other', async () => {
    type Mod = typeof import('./pythonJobs');
    const a = await freshCopy<Mod>('./pythonJobs');
    const b = await freshCopy<Mod>('./pythonJobs');
    let release!: () => void;
    const order: string[] = [];
    const first = a.queuePythonJob(() => new Promise<void>((r) => { release = () => { order.push('a'); r(); }; }));
    const second = b.queuePythonJob(async () => { order.push('b'); });
    await new Promise((r) => setTimeout(r, 10));
    expect(order).toEqual([]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['a', 'b']);
  });
});
