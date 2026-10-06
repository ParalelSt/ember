// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type PocketBase from 'pocketbase';
import { fakePocketBase } from '@/test-utils/fakePocketBase';
import { missingUploadIds } from './missing';

vi.mock('@/lib/logger/server', () => ({ serverLogger: { warn: vi.fn(), error: vi.fn() } }));

const upload = (id: string) => ({ id, collectionId: 'uploads', collectionName: 'uploads', created: '', title: id });

// Bughunt V13: Admin > Tracks listed catalog rows for deleted uploads as
// if they still played.
describe('missingUploadIds', () => {
  it('names the ids with no upload record left, in one query', async () => {
    const store = fakePocketBase({ uploads: [upload('keep1'), upload('keep2')] });
    const gone = await missingUploadIds(store.pb, ['keep1', 'gone1', 'keep2', 'gone2', 'gone1']);
    expect([...gone].sort()).toEqual(['gone1', 'gone2']);
    expect(store.calls.filter((c) => c.collection === 'uploads')).toHaveLength(1);
  });

  it('asks nothing for a page with no uploads on it', async () => {
    const store = fakePocketBase({ uploads: [] });
    expect((await missingUploadIds(store.pb, [])).size).toBe(0);
    expect(store.calls).toHaveLength(0);
  });

  it('marks nothing when the lookup fails', async () => {
    const pb = {
      filter: (s: string) => s,
      collection: () => ({ getFullList: async () => { throw new Error('down'); } }),
    } as unknown as PocketBase;
    expect((await missingUploadIds(pb, ['a'])).size).toBe(0);
  });
});
