import { describe, expect, it } from 'vitest';
import { dedupeItems, songKeyOf } from '@/lib/import/sources/dedupe';
import type { TransferItem } from '@/lib/import/sources/types';

const item = (over: Partial<TransferItem>): TransferItem => ({
  position: 0,
  title: 'Paper Lanterns',
  artists: ['Halcyon Drift'],
  artist: 'Halcyon Drift',
  durationMs: null,
  explicit: null,
  uri: null,
  likedAt: null,
  ...over,
});

describe('songKeyOf', () => {
  it('a uri is the whole key: two rows with the same uri are one song', () => {
    expect(songKeyOf(item({ uri: 'spotify:track:aaa', title: 'A' }))).toBe(
      songKeyOf(item({ uri: 'spotify:track:aaa', title: 'Quite Another Name' })),
    );
  });

  it('with no uri, the matcher’s own normalising decides', () => {
    expect(songKeyOf(item({ title: 'Paper Lanterns (feat. Someone)' }))).toBe(songKeyOf(item({ title: 'Paper Lanterns' })));
    expect(songKeyOf(item({ title: 'PAPER  lanterns' }))).toBe(songKeyOf(item({ title: 'Paper Lanterns' })));
  });

  it('a different song by the same artist is a different key', () => {
    expect(songKeyOf(item({ title: 'Nine Streets' }))).not.toBe(songKeyOf(item({ title: 'Paper Lanterns' })));
  });

  it('the same song name by two artists is two songs', () => {
    expect(songKeyOf(item({ artists: ['Mirror Hall'], artist: 'Mirror Hall' }))).not.toBe(songKeyOf(item({})));
  });
});

describe('dedupeItems', () => {
  it('keeps the first of a repeat and renumbers what is left', () => {
    const r = dedupeItems([
      item({ position: 0, title: 'A' }),
      item({ position: 1, title: 'B' }),
      item({ position: 2, title: 'A' }),
      item({ position: 3, title: 'C' }),
    ]);
    expect(r.items.map((i) => [i.position, i.title])).toEqual([
      [0, 'A'],
      [1, 'B'],
      [2, 'C'],
    ]);
    expect(r.dropped).toBe(1);
  });

  it('keeps the first row’s like date, not the repeat’s', () => {
    const r = dedupeItems([item({ title: 'A', likedAt: 100 }), item({ title: 'A', likedAt: 900 })]);
    expect(r.items[0].likedAt).toBe(100);
  });

  it('a list with no repeats is handed back unchanged', () => {
    const items = [item({ position: 0, title: 'A' }), item({ position: 1, title: 'B' })];
    expect(dedupeItems(items)).toEqual({ items, dropped: 0 });
  });
});
