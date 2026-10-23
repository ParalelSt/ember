import { describe, expect, it } from 'vitest';
import { importItemFinder, importRows, itemForTrack, reviewQueue } from '@/lib/import/rows';
import type { ImportItem } from '@/lib/import/types';
import type { Track } from '@/types/track';

const track = (id: string): Track => ({
  id: `youtube:${id}`,
  source: 'youtube',
  sourceId: id,
  title: id,
  artist: '',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 1,
  artworkUrl: null,
  streamUrl: '',
});

const item = (position: number, status: ImportItem['status'], videoId: string | null = null): ImportItem => ({
  id: `i${position}`,
  position,
  status,
  source: { position, title: `s${position}`, artists: [], artist: '', durationMs: null, explicit: null, uri: null },
  likedAt: null,
  videoId,
  confidence: null,
  candidates: [],
});

const shape = (rows: ReturnType<typeof importRows>) => rows.map((r) => (r.kind === 'track' ? r.track.sourceId : `${r.kind}:${r.item.position}`));

describe('importRows', () => {
  const items = [
    item(4, 'pending'),
    item(0, 'accepted', 'a'),
    item(1, 'review'),
    item(2, 'missing'),
    item(3, 'resolved', 'c'),
    item(5, 'pending'),
    item(6, 'skipped'),
  ];
  // The playlist fetch sorts by position; a hand-added song sits at the end.
  const tracks = [track('a'), track('c'), track('mine')];

  it('interleaves tracks and placeholders in source order, hand-added songs last', () => {
    expect(shape(importRows(items, tracks, 'running'))).toEqual([
      'a',
      'review:1',
      'missing:2',
      'c',
      'pending:4',
      'pending:5',
      'mine',
    ]);
  });

  it('marks only the first pending row as being matched, and only while running', () => {
    const running = importRows(items, tracks, 'running').filter((r) => r.kind === 'pending');
    expect(running.map((r) => r.kind === 'pending' && r.next)).toEqual([true, false]);
    const paused = importRows(items, tracks, 'paused').filter((r) => r.kind === 'pending');
    expect(paused.map((r) => r.kind === 'pending' && r.next)).toEqual([false, false]);
  });

  it('a stopped import drops the rows it will never match', () => {
    expect(shape(importRows(items, tracks, 'cancelled'))).toEqual(['a', 'review:1', 'missing:2', 'c', 'mine']);
  });

  it('an accepted song removed by hand is not shown', () => {
    expect(shape(importRows([item(0, 'accepted', 'gone')], [], 'done'))).toEqual([]);
  });
});

describe('reviewQueue and itemForTrack', () => {
  it('walks the unsure songs first, then the not-found ones', () => {
    const q = reviewQueue([item(3, 'missing'), item(2, 'review'), item(0, 'missing'), item(1, 'review'), item(4, 'accepted', 'x')]);
    expect(q.map((i) => `${i.status}:${i.position}`)).toEqual(['review:1', 'review:2', 'missing:0', 'missing:3']);
  });

  it('finds the import row behind a playlist track, for Re-match', () => {
    const items = [item(0, 'accepted', 'a'), item(1, 'resolved', 'b'), item(2, 'review')];
    expect(itemForTrack(items, track('b'))?.id).toBe('i1');
    expect(itemForTrack(items, track('mine'))).toBeNull();
  });
});

describe('importItemFinder', () => {
  it('answers like itemForTrack, the first accepted or resolved row for the song', () => {
    const items = [item(0, 'review', 'b'), item(1, 'accepted', 'a'), item(2, 'resolved', 'b'), item(3, 'accepted', 'b'), item(4, 'missing')];
    const find = importItemFinder(items);
    for (const t of [track('a'), track('b'), track('mine')]) expect(find(t)).toBe(itemForTrack(items, t));
    expect(find(track('b'))?.id).toBe('i2');
  });

  it('reads the items once for a whole list, not once per row', () => {
    // Liked during a transfer, or an imported playlist: every row asked for
    // its item, and each ask walked every item (thousands x thousands).
    let reads = 0;
    const items = Array.from({ length: 300 }, (_, i) => {
      const row = item(i, 'accepted', `v${i}`);
      return Object.defineProperty(row, 'status', { get: () => { reads += 1; return 'accepted'; } });
    });
    const find = importItemFinder(items);
    for (let i = 0; i < 300; i += 1) expect(find(track(`v${i}`))?.id).toBe(`i${i}`);
    expect(reads).toBeLessThanOrEqual(600);
  });
});
