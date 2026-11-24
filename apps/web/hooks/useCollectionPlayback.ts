'use client';

import { usePlayer } from '@/components/player/PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { sameContext } from '@/lib/collections';
import { shuffle as shuffleList } from '@/lib/shuffle';
import type { PlaybackContext, Track } from '@/types/track';

export interface CollectionPlayback {
  play: () => void;
  shuffle: () => void;
  shuffleOn: boolean;
  active: boolean;
}

/** Play and shuffle for a collection (playlist, Liked, Recent, Uploads).
 *  `active` is whether THIS collection is the one currently playing: it
 *  drives both the shuffle button's toggle-vs-shuffle-play behavior and its
 *  pressed styling. */
export function useCollectionPlayback(tracks: Track[], context: PlaybackContext): CollectionPlayback {
  const { playTrack } = usePlayer();
  const shuffleOn = usePlayerStore((s) => s.shuffle);
  const toggleShuffle = usePlayerStore((s) => s.toggleShuffle);
  const active = usePlayerStore((s) => sameContext(s.context, context));

  const play = () => {
    if (tracks.length) playTrack(tracks[0], tracks, context);
  };

  // Every press is a shuffle play: a fresh random order replaces the queue
  // and starts on a random song, also while this collection is the one
  // playing. It used to be a toggle there (shuffle the tracks ahead, or turn
  // shuffle off and bring the old order back), so a second press never built
  // a new order. Shuffle on/off for the playing queue is the player's own
  // button.
  const shuffle = () => {
    if (!tracks.length) return;
    const queued = usePlayerStore.getState().queue;
    const sameAsQueued = (list: Track[]) => list.length === queued.length && list.every((s, k) => queued[k]?.id === s.id);
    let shuffled = shuffleList(tracks);
    // The very order already queued would look like nothing happened (likely
    // on a short list): draw again.
    for (let n = 0; n < 8 && tracks.length > 1 && sameAsQueued(shuffled); n++) shuffled = shuffleList(tracks);
    playTrack(shuffled[0], shuffled, context);
    // playTrack clears any previous shuffle snapshot, so record THIS
    // collection's original order right after, so shuffle-off can restore it.
    // Only when the list really is the queue now: with nothing in it that
    // can play, playTrack refuses it, and turning shuffle on then would
    // reorder the queue still playing by this list on shuffle-off.
    if (usePlayerStore.getState().queue !== shuffled) return;
    usePlayerStore.setState({ shuffle: true, orderBackup: tracks });
  };

  return { play, shuffle, shuffleOn, active };
}
