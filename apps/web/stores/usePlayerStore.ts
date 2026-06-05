'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { PlaybackContext, Track } from '@/types/track';

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
      volume: 0.55,
      isPlaying: false,
      duration: 0,
      context: null,
      nowPlayingOpen: false,
      setQueue: (queue) => set({ queue }),
      setIndex: (index) => set({ index }),
      setPosition: (position) => set({ position }),
      setDuration: (duration) => set({ duration }),
      setIsPlaying: (isPlaying) => set({ isPlaying }),
      setVolume: (volume) => set({ volume: Math.min(0.85, Math.max(0, volume)) }),
      setContext: (context) => set({ context }),
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
      }),
    },
  ),
);
