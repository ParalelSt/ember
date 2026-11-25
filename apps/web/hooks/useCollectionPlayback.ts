'use client';

import { usePlayer } from '@/components/player/PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { sameContext } from '@/lib/collections';
import { shuffle as shuffleList, shuffleFresh } from '@/lib/shuffle';
import type { PlaybackContext, Track } from '@/types/track';

export interface CollectionPlayback {
  play: () => void;
  shuffle: () => void;
  shuffleOn: boolean;
  active: boolean;
}

/** Play and shuffle for a collection (playlist, Liked, Recent, Uploads).
 *  `active` is whether THIS collection is the one currently playing: it
 *  decides between re-dealing the queue behind the song playing and a fresh
 *  shuffle play, and drives the button's pressed styling. */
export function useCollectionPlayback(tracks: Track[], context: PlaybackContext): CollectionPlayback {
  const { playTrack } = usePlayer();
  const shuffleOn = usePlayerStore((s) => s.shuffle);
  const active = usePlayerStore((s) => sameContext(s.context, context));

  const play = () => {
    if (tracks.length) playTrack(tracks[0], tracks, context);
  };

  // Every press builds a fresh random order, never a toggle (it used to
  // turn shuffle off on the second press). Shuffle on/off for the playing
  // queue is the player's own button.
  // - This collection is playing: the song playing is left alone (no load,
  //   same position). It becomes the queue's first entry, with songs added by
  //   hand next and every OTHER song of the collection behind them in a new
  //   random order, the ones already played included.
  // - Otherwise: a shuffle play, a random order that starts on a random song.
  const shuffle = () => {
    if (!tracks.length) return;
    const st = usePlayerStore.getState();
    const playing = st.queue[st.index];
    const isQueued = (s: Track) => !!(s as { queued?: boolean }).queued;
    if (active && playing) {
      const handQueued = st.queue.filter((s, k) => k > st.index && isQueued(s));
      const others = tracks.slice();
      const at = others.findIndex((s) => s.id === playing.id);
      if (at >= 0) others.splice(at, 1);
      const old = st.queue.slice(st.index + 1).filter((s) => !isQueued(s)).map((s) => s.id);
      const order = shuffleFresh(others, old);
      usePlayerStore.setState({
        queue: [playing, ...handQueued, ...order],
        index: 0,
        baseCount: 1 + handQueued.length + order.length,
        shuffle: true,
        orderBackup: tracks,
        radioHeldFor: null,
      });
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
