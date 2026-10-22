import { describe, expect, it } from 'vitest';
import { addToQueue, type QueuedTrack } from './addToQueue';
import type { Track } from '../../types/track';

const t = (id: string): Track => ({
  id,
  source: 'youtube',
  sourceId: id,
  title: id,
  artist: 'A',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 1,
  artworkUrl: null,
  streamUrl: '',
});
const ids = (q: Track[]) => q.map((x) => x.id);

describe('addToQueue', () => {
  it('puts the song right after the one playing', () => {
    const r = addToQueue({ queue: [t('a'), t('b'), t('c')], index: 0, baseCount: 3 }, t('x'));
    expect(ids(r!.queue)).toEqual(['a', 'x', 'b', 'c']);
    expect((r!.queue[1] as QueuedTrack).queued).toBe(true);
  });

  it('a second song goes after the first one queued, not ahead of it', () => {
    const one = addToQueue({ queue: [t('a'), t('b')], index: 0, baseCount: 2 }, t('x'))!;
    const two = addToQueue({ queue: one.queue, index: 0, baseCount: one.baseCount }, t('y'))!;
    expect(ids(two.queue)).toEqual(['a', 'x', 'y', 'b']);
  });

  it('grows the playlist count when added inside it, so loop-all still wraps after the playlist', () => {
    expect(addToQueue({ queue: [t('a'), t('b')], index: 0, baseCount: 2 }, t('x'))!.baseCount).toBe(3);
  });

  it('leaves the count alone when added after the playlist (radio, or no playlist)', () => {
    expect(addToQueue({ queue: [t('a'), t('b'), t('r')], index: 1, baseCount: 2 }, t('x'))!.baseCount).toBe(2);
    expect(addToQueue({ queue: [t('a')], index: 0, baseCount: 0 }, t('x'))!.baseCount).toBe(0);
  });

  it('adds at the end while the last song plays', () => {
    expect(ids(addToQueue({ queue: [t('a'), t('b')], index: 1, baseCount: 2 }, t('x'))!.queue)).toEqual(['a', 'b', 'x']);
  });

  it('can queue the song that is already playing', () => {
    expect(ids(addToQueue({ queue: [t('a'), t('b')], index: 0, baseCount: 2 }, t('a'))!.queue)).toEqual(['a', 'a', 'b']);
  });

  it('returns null with nothing loaded', () => {
    expect(addToQueue({ queue: [], index: -1, baseCount: 0 }, t('x'))).toBeNull();
  });

  it('does not change the queue it was given', () => {
    const queue = [t('a'), t('b')];
    addToQueue({ queue, index: 0, baseCount: 2 }, t('x'));
    expect(ids(queue)).toEqual(['a', 'b']);
  });
});
