import { describe, expect, it } from 'vitest';
import { dropBlocked } from './dropBlocked';
import type { Track } from '../../types/track';

const t = (id: string, title = id, artist = 'A'): Track => ({
  id: `youtube:${id}`, source: 'youtube', sourceId: id, title, artist, artistId: null,
  album: null, albumId: null, durationSec: 1, artworkUrl: null, streamUrl: '',
});

describe('dropBlocked', () => {
  const blocked = t('bad', 'Bad Song');

  it('takes the blocked song out of the radio songs still to come', () => {
    const queue = [t('p1'), t('p2'), t('r1'), blocked, t('r2')];
    const out = dropBlocked({ queue, index: 0, baseCount: 2, orderBackup: null }, blocked)!;
    expect(out.queue.map((x) => x.sourceId)).toEqual(['p1', 'p2', 'r1', 'r2']);
  });

  it('other uploads of the same song go too', () => {
    const lyric = t('bad2', 'Bad Song (Lyric Video)');
    const out = dropBlocked({ queue: [t('p1'), lyric], index: 0, baseCount: 1, orderBackup: null }, blocked)!;
    expect(out.queue.map((x) => x.sourceId)).toEqual(['p1']);
  });

  it('keeps the playlist\'s own songs, the song playing and songs queued by hand', () => {
    const queuedByHand = { ...blocked, queued: true };
    expect(dropBlocked({ queue: [blocked, t('p2')], index: 0, baseCount: 2, orderBackup: null }, blocked)).toBeNull();
    expect(dropBlocked({ queue: [t('p1'), t('p2'), blocked], index: 0, baseCount: 3, orderBackup: null }, blocked)).toBeNull();
    expect(dropBlocked({ queue: [t('p1'), queuedByHand], index: 0, baseCount: 1, orderBackup: null }, blocked)).toBeNull();
  });

  it('keeps the shuffle backup in step', () => {
    const queue = [t('p1'), blocked, t('r2')];
    const out = dropBlocked({ queue, index: 0, baseCount: 1, orderBackup: [t('p1'), queue[1], queue[2]] }, blocked)!;
    expect(out.orderBackup!.map((x) => x.sourceId)).toEqual(['p1', 'r2']);
  });
});
