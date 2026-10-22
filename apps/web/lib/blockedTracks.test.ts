import { describe, expect, it, vi } from 'vitest';
import { listBlocked, withoutBlocked } from './blockedTracks';
import type { Track } from '@/types/track';
import type PocketBase from 'pocketbase';

const t = (id: string, title = id, artist = 'A'): Track => ({
  id: `youtube:${id}`, source: 'youtube', sourceId: id, title, artist, artistId: null,
  album: null, albumId: null, durationSec: 1, artworkUrl: null, streamUrl: '',
});

describe('withoutBlocked', () => {
  it('drops the blocked song in any id spelling and other uploads of it, keeps the rest in order', () => {
    const list = [t('a'), { ...t('x', 'Bad'), id: 'youtube:youtube:x' }, t('y', 'Bad (Lyric Video)'), t('b')];
    expect(withoutBlocked(list, [t('x', 'Bad')]).map((s) => s.sourceId)).toEqual(['a', 'b']);
  });

  it('with nothing blocked, gives the same list back', () => {
    const list = [t('a')];
    expect(withoutBlocked(list, [])).toBe(list);
  });
});

describe('listBlocked', () => {
  it('maps the expanded rows to tracks, and is empty when PocketBase cannot answer', async () => {
    const row = { expand: { track: { external_id: 'youtube:x', source: 'youtube', source_id: 'x', title: 'Bad', artist: 'A' } } };
    const pb = {
      filter: (s: string) => s,
      collection: () => ({ getFullList: vi.fn(async () => [row]) }),
    } as unknown as PocketBase;
    expect((await listBlocked(pb, 'u1')).map((x) => x.title)).toEqual(['Bad']);
    const down = { filter: (s: string) => s, collection: () => ({ getFullList: async () => { throw new Error('down'); } }) } as unknown as PocketBase;
    expect(await listBlocked(down, 'u1')).toEqual([]);
  });
});
