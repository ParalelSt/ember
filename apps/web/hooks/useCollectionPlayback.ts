'use client';

import { usePlayer } from '@/components/player/PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { sameContext } from '@/lib/collections';
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

  // While THIS collection is playing it's a toggle: shuffle the tracks ahead
  // and leave the current song alone. It used to reshuffle from scratch and
  // jump to a new first track on every press, which felt like the button was
  // skipping.
  // When the collection isn't playing there's nothing to preserve, so it
  // behaves as "shuffle play" and starts somewhere random.
  const shuffle = () => {
    if (!tracks.length) return;
    if (active) {
      toggleShuffle();
      return;
    }
    const shuffled = tracks.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    playTrack(shuffled[0], shuffled, context);
    // playTrack clears any previous shuffle snapshot, so record THIS
    // collection's original order right after, so shuffle-off can restore it.
    usePlayerStore.setState({ shuffle: true, orderBackup: tracks });
  };

  return { play, shuffle, shuffleOn, active };
}
