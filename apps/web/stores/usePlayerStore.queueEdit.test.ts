/** The queue sheet's Next up edits, as store actions: the real queue
 *  changes (so Next, Previous and the native player follow it), the song
 *  playing and its index stay, and an edit that does nothing leaves the
 *  state (and its save) alone. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePlayerStore } from './usePlayerStore';
import type { Track } from '@/types/track';

function t(id: string): Track {
  return {
    id, source: 'youtube', sourceId: id, title: id, artist: 'x', artistId: null,
    album: null, albumId: null, durationSec: 100, artworkUrl: null, streamUrl: `/s/${id}`,
  };
}
const ids = () => usePlayerStore.getState().queue.map((x) => x.id);

beforeEach(() => {
  usePlayerStore.setState({
    queue: ['a', 'b', 'c', 'd', 'e'].map(t), index: 1, baseCount: 5, shuffle: false, orderBackup: null, isPlaying: true, radioHeldFor: null,
  });
});
afterEach(() => vi.restoreAllMocks());

describe('Next up edits in the player store', () => {
  it('moves, removes and plays next without touching the song playing', () => {
    const st = usePlayerStore.getState();
    st.moveUpcoming(4, 2);
    expect(ids()).toEqual(['a', 'b', 'e', 'c', 'd']);
    st.removeUpcoming(3);
    expect(ids()).toEqual(['a', 'b', 'e', 'd']);
    st.playNextUpcoming(3);
    expect(ids()).toEqual(['a', 'b', 'd', 'e']);
    const s = usePlayerStore.getState();
    expect(s.index).toBe(1);
    expect(s.queue[s.index].id).toBe('b');
    expect(s.baseCount).toBe(4);
    expect(s.isPlaying).toBe(true);
  });

  it('Clear keeps the song playing; Shuffle keeps the same songs and leaves the shuffle mode off', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    usePlayerStore.getState().shuffleUpcoming();
    expect(ids()).toEqual(['a', 'b', 'd', 'e', 'c']);
    expect(usePlayerStore.getState().shuffle).toBe(false);
    expect(usePlayerStore.getState().orderBackup).toBeNull();
    usePlayerStore.getState().clearUpcoming();
    expect(ids()).toEqual(['a', 'b']);
    expect(usePlayerStore.getState().index).toBe(1);
  });

  it('an edit that changes nothing does not write the store', () => {
    const before = usePlayerStore.getState();
    const seen = vi.fn();
    const off = usePlayerStore.subscribe(seen);
    before.moveUpcoming(1, 3); // the song playing
    before.removeUpcoming(0); // a song already played
    before.moveUpcoming(2, 2);
    off();
    expect(seen).not.toHaveBeenCalled();
    expect(usePlayerStore.getState()).toBe(before);
  });

  it('turning the shuffle mode off after an edit restores the order without the removed song', () => {
    usePlayerStore.getState().toggleShuffle();
    const shuffled = ids();
    const gone = shuffled[3];
    usePlayerStore.getState().removeUpcoming(3);
    usePlayerStore.getState().toggleShuffle();
    expect(ids()).toEqual(['a', 'b', 'c', 'd', 'e'].filter((id) => id !== gone));
    expect(usePlayerStore.getState().queue[usePlayerStore.getState().index].id).toBe('b');
  });

  it('with the shuffle mode on, edits go to the shuffled queue and the mode stays on', () => {
    usePlayerStore.getState().toggleShuffle();
    const backup = usePlayerStore.getState().orderBackup;
    const [, , x, y, z] = ids();
    usePlayerStore.getState().moveUpcoming(4, 2);
    expect(ids()).toEqual(['a', 'b', z, x, y]);
    usePlayerStore.getState().shuffleUpcoming();
    expect(ids().slice(0, 2)).toEqual(['a', 'b']);
    expect(ids().slice(2).sort()).toEqual(['c', 'd', 'e']);
    const s = usePlayerStore.getState();
    expect(s.shuffle).toBe(true);
    expect(s.orderBackup).toBe(backup);
    // Off: the order it had before the mode, all songs there.
    usePlayerStore.getState().toggleShuffle();
    expect(ids()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(usePlayerStore.getState().index).toBe(1);
  });

  it('Clear with the shuffle mode on: off afterwards does not bring the songs back', () => {
    usePlayerStore.getState().toggleShuffle();
    usePlayerStore.getState().clearUpcoming();
    expect(ids()).toEqual(['a', 'b']);
    expect(usePlayerStore.getState().shuffle).toBe(true);
    usePlayerStore.getState().toggleShuffle();
    expect(ids()).toEqual(['a', 'b']);
    expect(usePlayerStore.getState().index).toBe(1);
  });

  it('a Next up edit made after the song changed acts on the queue as it is now', () => {
    usePlayerStore.setState({ index: 3 });
    usePlayerStore.getState().moveUpcoming(2, 4); // now behind the song playing: refused
    expect(ids()).toEqual(['a', 'b', 'c', 'd', 'e']);
    usePlayerStore.getState().removeUpcoming(2);
    expect(ids()).toEqual(['a', 'b', 'c', 'd', 'e']);
    usePlayerStore.getState().removeUpcoming(4);
    expect(ids()).toEqual(['a', 'b', 'c', 'd']);
    expect(usePlayerStore.getState().index).toBe(3);
  });

  it('emptying Next up by hand holds radio for the song playing; anything ahead lets it go', () => {
    const st = usePlayerStore.getState();
    st.clearUpcoming();
    expect(usePlayerStore.getState().radioHeldFor).toBe('b');

    usePlayerStore.setState({ queue: ['a', 'b', 'c'].map(t), index: 1, baseCount: 3, radioHeldFor: null });
    st.removeUpcoming(2); // the last song
    expect(ids()).toEqual(['a', 'b']);
    expect(usePlayerStore.getState().radioHeldFor).toBe('b');
    expect(usePlayerStore.getState().isPlaying).toBe(true);

    usePlayerStore.setState({ queue: ['a', 'b', 'c', 'd'].map(t), index: 1, baseCount: 4, radioHeldFor: 'b' });
    st.removeUpcoming(2);
    expect(usePlayerStore.getState().radioHeldFor).toBeNull();
  });

  it('only dead songs left ahead counts as empty', () => {
    const dead = { ...t('x'), unavailableAt: '2026-10-01T10:00:00Z' };
    usePlayerStore.setState({ queue: [t('a'), t('b'), t('c'), dead], index: 1, baseCount: 4 });
    usePlayerStore.getState().removeUpcoming(2);
    expect(usePlayerStore.getState().radioHeldFor).toBe('b');
  });

  it('the hold on radio is not saved', () => {
    const options = usePlayerStore.persist.getOptions();
    const saved = options.partialize!({ ...usePlayerStore.getState(), radioHeldFor: 'b' });
    expect(saved).not.toHaveProperty('radioHeldFor');
  });
});
