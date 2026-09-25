'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { shuffle } from '@/lib/shuffle';
import type { PlaybackContext, Track } from '@/types/track';

export type LoopMode = 'off' | 'all' | 'one';

interface PlayerState {
  queue: Track[];
  index: number;
  position: number;
  volume: number;
  isPlaying: boolean;
  duration: number;
  /** Where the current queue was started from. Used by radio mode to decide
   *  whether to keep the same artist around or drift toward similar genre. */
  context: PlaybackContext | null;
  /** off → no looping; all → restart the queue from track 0 on end (radio
   *  auto-extend is suppressed while this is active); one → replay current
   *  track on end. */
  loopMode: LoopMode;
  /** How many tracks at the START of the queue came from the source the user
   *  actually chose (a playlist), before radio appended extras. Loop-all uses
   *  it as the wrap point so "loop" means "loop THIS playlist", not "loop the
   *  playlist plus everything radio tacked on". 0 = no curated base. */
  baseCount: number;
  /** True = the queue is shuffled. The pre-shuffle order is kept in
   *  `orderBackup` so turning shuffle off restores it exactly (Spotify's
   *  behaviour) rather than leaving the queue scrambled. */
  shuffle: boolean;
  /** Snapshot of the queue as it was before shuffling; null when shuffle is
   *  off. Not persisted — a reload starts unshuffled. */
  orderBackup: Track[] | null;
  /** True = audio output forced to 0. Restores previous `volume` when toggled
   *  off; the slider position stays put so the user doesn't lose their level. */
  muted: boolean;
  /** Full-screen "Now Playing" overlay (mobile only). Ephemeral — never
   *  persisted, so a reload always starts collapsed. */
  nowPlayingOpen: boolean;
  setQueue: (queue: Track[]) => void;
  setIndex: (i: number) => void;
  setPosition: (p: number) => void;
  setDuration: (d: number) => void;
  setIsPlaying: (b: boolean) => void;
  setVolume: (v: number) => void;
  setContext: (c: PlaybackContext | null) => void;
  setLoopMode: (m: LoopMode) => void;
  toggleShuffle: () => void;
  cycleLoopMode: () => void;
  setMuted: (b: boolean) => void;
  toggleMuted: () => void;
  setNowPlayingOpen: (b: boolean) => void;
}

/** The queue put back in its pre-shuffle order, as it is NOW: the snapshot
 *  only decides the order. A song removed since stays removed, a song added
 *  since (a carlist session's picks, add-to-queue) stays, after the original
 *  ones in the order it was added, and every song is the queue's current copy
 *  (an unavailable flag set while shuffled is kept). A song listed twice is
 *  matched copy by copy. `index` follows the playing entry. */
export function restoreOrder(original: Track[], queue: Track[], index: number): { queue: Track[]; index: number } {
  const positions = new Map<string, number[]>();
  queue.forEach((t, i) => {
    const list = positions.get(t.id);
    if (list) list.push(i);
    else positions.set(t.id, [i]);
  });
  const order: number[] = [];
  for (const t of original) {
    const i = positions.get(t.id)?.shift();
    if (i !== undefined) order.push(i);
  }
  const placed = new Set(order);
  queue.forEach((_, i) => {
    if (!placed.has(i)) order.push(i);
  });
  const at = order.indexOf(index);
  return { queue: order.map((i) => queue[i]), index: at >= 0 ? at : index };
}

/** Persisted slices: queue, index, position, volume, context. isPlaying +
 *  duration are derived from the audio element each session. */
export const usePlayerStore = create<PlayerState>()(
  persist(
    (set) => ({
      queue: [],
      index: -1,
      position: 0,
      // Default sits in the first quarter of the slider — a fresh device
      // starts QUIET (0.25^1.5 ≈ 0.13 gain), not blasting from the middle.
      volume: 0.25,
      isPlaying: false,
      duration: 0,
      context: null,
      loopMode: 'off',
      baseCount: 0,
      shuffle: false,
      orderBackup: null,
      muted: false,
      nowPlayingOpen: false,
      setQueue: (queue) => set({ queue }),
      setIndex: (index) => set({ index }),
      setPosition: (position) => set({ position }),
      setDuration: (duration) => set({ duration }),
      setIsPlaying: (isPlaying) => set({ isPlaying }),
      setVolume: (volume) => set({ volume: Math.min(1, Math.max(0, volume)) }),
      setContext: (context) => set({ context }),
      setLoopMode: (loopMode) => set({ loopMode }),
      /** Shuffle the upcoming tracks only — whatever is playing stays playing
       *  and stays at the current index, so toggling never interrupts audio.
       *  Turning it off restores the original order and re-points the index at
       *  the same track. */
      toggleShuffle: () => set((s) => {
        if (s.shuffle) {
          const original = s.orderBackup;
          if (!original) return { shuffle: false, orderBackup: null };
          const { queue, index } = restoreOrder(original, s.queue, s.index);
          return { shuffle: false, orderBackup: null, queue, index };
        }
        if (s.queue.length < 2) return { shuffle: true, orderBackup: s.queue.slice() };
        const backup = s.queue.slice();
        const played = s.queue.slice(0, Math.max(0, s.index + 1));
        const upcoming = s.queue.slice(Math.max(0, s.index + 1));
        // Shuffle the upcoming tracks only; the played prefix (including the
        // current track) stays put.
        return { shuffle: true, orderBackup: backup, queue: [...played, ...shuffle(upcoming)] };
      }),
      // off → all → one → off. Any unexpected persisted value lands on 'off'.
      cycleLoopMode: () => set((s) => ({
        loopMode: s.loopMode === 'off' ? 'all' : s.loopMode === 'all' ? 'one' : 'off',
      })),
      setMuted: (muted) => set({ muted }),
      toggleMuted: () => set((s) => ({ muted: !s.muted })),
      setNowPlayingOpen: (nowPlayingOpen) => set({ nowPlayingOpen }),
    }),
    {
      name: 'ember.player.v1',
      partialize: (s) => ({
        queue: s.queue,
        index: s.index,
        position: s.position,
        volume: s.volume,
        context: s.context,
        loopMode: s.loopMode,
        baseCount: s.baseCount,
        // shuffle is intentionally left out: its pre-shuffle order
        // (orderBackup) is never persisted, so persisting the flag alone
        // would reload into a queue that LOOKS shuffled but has no backup to
        // restore when the user turns it off. A reload always starts
        // unshuffled (see the orderBackup comment above).
        muted: s.muted,
      }),
    },
  ),
);
