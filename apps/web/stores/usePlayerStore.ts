'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Track } from '@/types/track';

interface PlayerState {
  queue: Track[];
  index: number;
  position: number;
  volume: number;
  isPlaying: boolean;
  duration: number;
  setQueue: (queue: Track[]) => void;
  setIndex: (i: number) => void;
  setPosition: (p: number) => void;
  setDuration: (d: number) => void;
  setIsPlaying: (b: boolean) => void;
  setVolume: (v: number) => void;
}

/** Persisted slices: queue, index, position, volume. isPlaying + duration are
 *  derived from the audio element each session. */
export const usePlayerStore = create<PlayerState>()(
  persist(
    (set) => ({
      queue: [],
      index: -1,
      position: 0,
      volume: 0.4,
      isPlaying: false,
      duration: 0,
      setQueue: (queue) => set({ queue }),
      setIndex: (index) => set({ index }),
      setPosition: (position) => set({ position }),
      setDuration: (duration) => set({ duration }),
      setIsPlaying: (isPlaying) => set({ isPlaying }),
      setVolume: (volume) => set({ volume }),
    }),
    {
      name: 'ember.player.v1',
      partialize: (s) => ({ queue: s.queue, index: s.index, position: s.position, volume: s.volume }),
    },
  ),
);
