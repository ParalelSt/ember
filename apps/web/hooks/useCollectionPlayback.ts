'use client';

import { usePlayer } from '@/components/player/PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { sameContext } from '@/lib/collections';
import { shuffleFresh } from '@/lib/shuffle';
import type { PlaybackContext, Track } from '@/types/track';

export interface CollectionPlayback {
  play: () => void;
  shuffle: () => void;
  shuffleOn: boolean;
  active: boolean;
}

/** Play and shuffle for a collection (playlist, Liked, Recent, Uploads).
 *  `active` is whether THIS collection is the one currently playing: it
 *  decides between the player's shuffle toggle and a fresh shuffle play, and
 *  drives the button's pressed styling (this collection playing, shuffle on). */
export function useCollectionPlayback(tracks: Track[], context: PlaybackContext): CollectionPlayback {
  const { playTrack } = usePlayer();
  const shuffleOn = usePlayerStore((s) => s.shuffle);
  const active = usePlayerStore((s) => sameContext(s.context, context));

  const play = () => {
    if (tracks.length) playTrack(tracks[0], tracks, context);
  };

  // Works like the player's own shuffle buttons.
  // - This collection is playing: the player's toggle (shuffle on re-deals
  //   behind the song playing, which keeps playing; shuffle off puts the
  //   original order back around it).
  // - Otherwise: a shuffle play, a random order that starts on a random song.
  const shuffle = () => {
    if (!tracks.length) return;
    const st = usePlayerStore.getState();
    if (active && st.queue[st.index]) {
      st.toggleShuffle();
      return;
    }
    const shuffled = shuffleFresh(tracks, st.queue.map((s) => s.id));
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
