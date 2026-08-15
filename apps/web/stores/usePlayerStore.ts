'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
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
          const current = s.queue[s.index];
          const index = current ? original.findIndex((t) => t.id === current.id) : s.index;
          return { shuffle: false, orderBackup: null, queue: original, index: index >= 0 ? index : s.index };
        }
        if (s.queue.length < 2) return { shuffle: true, orderBackup: s.queue.slice() };
        const backup = s.queue.slice();
        const played = s.queue.slice(0, Math.max(0, s.index + 1));
        const upcoming = s.queue.slice(Math.max(0, s.index + 1));
        // Fisher-Yates over the upcoming tracks only.
        for (let i = upcoming.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [upcoming[i], upcoming[j]] = [upcoming[j], upcoming[i]];
        }
        return { shuffle: true, orderBackup: backup, queue: [...played, ...upcoming] };
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
        shuffle: s.shuffle,
        muted: s.muted,
      }),
    },
  ),
);
