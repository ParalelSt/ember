/** Shuffle anywhere (the player's button, a remote device's command, the
 *  queue's Shuffle Next up): the song playing is never switched, the rest of
 *  the queue is dealt again behind it and never in the order it had. */
import { beforeEach, describe, expect, it } from 'vitest';
import { usePlayerStore } from './usePlayerStore';
import { shuffleFresh } from '@/lib/shuffle';
import type { Track } from '@/types/track';

const t = (id: string): Track => ({
  id, source: 'youtube', sourceId: id, title: id, artist: 'x', artistId: null,
  album: null, albumId: null, durationSec: 100, artworkUrl: null, streamUrl: `/s/${id}`,
});
const LIST = Array.from({ length: 10 }, (_, i) => t(`s${i}`));
const ids = () => usePlayerStore.getState().queue.map((x) => x.id);
const playing = () => { const s = usePlayerStore.getState(); return s.queue[s.index]?.id; };

beforeEach(() => {
  usePlayerStore.setState({ queue: LIST, index: 4, position: 33, shuffle: false, orderBackup: null });
});

describe('toggleShuffle (player button, remote command)', () => {
  it('keeps the song and its position, re-deals every other song once, played ones too', () => {
    usePlayerStore.getState().toggleShuffle();
    const s = usePlayerStore.getState();
    expect(s.shuffle).toBe(true);
    expect(playing()).toBe('s4');
    expect(s.position).toBe(33);
    expect(ids().slice().sort()).toEqual(LIST.map((x) => x.id).sort());
    expect(s.queue).toHaveLength(10);
  });

  it('never re-deals the up next it already had', () => {
    const two = [t('a'), t('b'), t('c')];
    for (let n = 0; n < 30; n++) {
      usePlayerStore.setState({ queue: two, index: 0, shuffle: false, orderBackup: null });
      usePlayerStore.getState().toggleShuffle();
      expect(ids()).not.toEqual(['a', 'b', 'c']);
      expect(playing()).toBe('a');
    }
  });

  it('off restores the order around the song playing, which keeps playing', () => {
    usePlayerStore.getState().toggleShuffle();
    usePlayerStore.getState().toggleShuffle();
    const s = usePlayerStore.getState();
    expect(s.shuffle).toBe(false);
    expect(ids()).toEqual(LIST.map((x) => x.id));
    expect(playing()).toBe('s4');
    expect(s.index).toBe(4);
    expect(s.position).toBe(33);
  });

  it('keeps songs added by hand right after the song playing', () => {
    const hand = { ...t('h'), queued: true } as Track;
    usePlayerStore.setState({ queue: [...LIST.slice(0, 5), hand, ...LIST.slice(5)], index: 4 });
    usePlayerStore.getState().toggleShuffle();
    expect(ids().slice(0, 2)).toEqual(['s4', 'h']);
  });
});

describe('shuffleUpcoming (Shuffle Next up)', () => {
  it('keeps the song playing and gives a different up next every press', () => {
    for (let n = 0; n < 10; n++) {
      const before = ids().slice(5).join();
      usePlayerStore.getState().shuffleUpcoming();
      expect(playing()).toBe('s4');
      expect(ids().slice(5).join()).not.toBe(before);
      expect(ids().slice(5).sort()).toEqual(['s5', 's6', 's7', 's8', 's9']);
    }
  });
});

describe('shuffleFresh', () => {
  it('is never the previous order, even for two songs', () => {
    const two = [t('a'), t('b')];
    for (let n = 0; n < 30; n++) expect(shuffleFresh(two, ['a', 'b']).map((x) => x.id)).toEqual(['b', 'a']);
  });
});
