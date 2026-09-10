import { beforeEach, describe, expect, it } from 'vitest';
import { usePlayerStore } from './usePlayerStore';
import type { Track } from '@/types/track';

function track(id: string): Track {
  return {
    id,
    source: 'youtube',
    sourceId: id,
    title: `Track ${id}`,
    artist: 'Artist',
    artistId: null,
    album: null,
    albumId: null,
    durationSec: 200,
    artworkUrl: null,
    streamUrl: `https://example.com/${id}`,
  };
}

const initial = usePlayerStore.getState();

beforeEach(() => {
  usePlayerStore.setState(initial, true);
});

describe('toggleShuffle', () => {
  it('turning on backs up the original order and keeps the current track first', () => {
    const queue = [track('a'), track('b'), track('c'), track('d')];
    usePlayerStore.setState({ queue, index: 0, shuffle: false, orderBackup: null });

    usePlayerStore.getState().toggleShuffle();

    const s = usePlayerStore.getState();
    expect(s.shuffle).toBe(true);
    expect(s.orderBackup).toEqual(queue);
    // Whatever is playing (index 0, track 'a') stays playing and stays first.
    expect(s.queue[0].id).toBe('a');
    expect(s.queue).toHaveLength(4);
    // The shuffled queue is a permutation of the original, not a different set.
    expect(s.queue.map((t) => t.id).sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('turning off restores the original order and re-points the index at the same track', () => {
    const original = [track('a'), track('b'), track('c'), track('d')];
    // Simulate an already-shuffled state: 'c' (originally index 2) is now
    // playing at index 0 of the shuffled queue.
    const shuffled = [track('c'), track('a'), track('d'), track('b')];
    usePlayerStore.setState({
      queue: shuffled,
      index: 0,
      shuffle: true,
      orderBackup: original,
    });

    usePlayerStore.getState().toggleShuffle();

    const s = usePlayerStore.getState();
    expect(s.shuffle).toBe(false);
    expect(s.orderBackup).toBeNull();
    expect(s.queue).toEqual(original);
    // 'c' is at index 2 in the original order.
    expect(s.index).toBe(2);
    expect(s.queue[s.index].id).toBe('c');
  });

  it('turning on with fewer than 2 tracks still backs up and flips the flag, without shuffling', () => {
    const queue = [track('a')];
    usePlayerStore.setState({ queue, index: 0, shuffle: false, orderBackup: null });

    usePlayerStore.getState().toggleShuffle();

    const s = usePlayerStore.getState();
    expect(s.shuffle).toBe(true);
    expect(s.orderBackup).toEqual(queue);
    expect(s.queue).toEqual(queue);
  });
});

describe('cycleLoopMode', () => {
  it('cycles off -> all -> one -> off', () => {
    usePlayerStore.setState({ loopMode: 'off' });

    usePlayerStore.getState().cycleLoopMode();
    expect(usePlayerStore.getState().loopMode).toBe('all');

    usePlayerStore.getState().cycleLoopMode();
    expect(usePlayerStore.getState().loopMode).toBe('one');

    usePlayerStore.getState().cycleLoopMode();
    expect(usePlayerStore.getState().loopMode).toBe('off');
  });
});

describe('toggleMuted', () => {
  it('muting flips the flag and keeps the volume level untouched', () => {
    usePlayerStore.setState({ muted: false, volume: 0.6 });

    usePlayerStore.getState().toggleMuted();

    const s = usePlayerStore.getState();
    expect(s.muted).toBe(true);
    expect(s.volume).toBe(0.6);
  });

  it('unmuting flips the flag back and the volume is still the previous level', () => {
    usePlayerStore.setState({ muted: true, volume: 0.6 });

    usePlayerStore.getState().toggleMuted();

    const s = usePlayerStore.getState();
    expect(s.muted).toBe(false);
    expect(s.volume).toBe(0.6);
  });
});
