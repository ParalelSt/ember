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
      volume: 0.45,
      isPlaying: false,
      duration: 0,
      context: null,
      loopMode: 'off',
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
        muted: s.muted,
      }),
    },
  ),
);
