'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface InFlight {
  current: number;
  total: number;
  trackTitle: string;
}

interface OfflineState {
  /** Playlist IDs with a complete OPFS download. */
  downloaded: string[];
  /** In-flight downloads keyed by playlist id — ephemeral. */
  inFlight: Record<string, InFlight>;
  /** Sum of bytes across all downloaded playlists. */
  totalBytes: number;
  /** True once boot hydration from OPFS meta.json has finished. */
  hydrated: boolean;

  setHydration: (input: { downloaded: string[]; totalBytes: number }) => void;
  beginDownload: (playlistId: string, total: number) => void;
  updateProgress: (playlistId: string, current: number, trackTitle: string) => void;
  finishDownload: (playlistId: string, bytesAdded: number) => void;
  failDownload: (playlistId: string) => void;
  removeDownload: (playlistId: string, bytesRemoved: number) => void;
}

/** Persisted slice: downloaded ids + totalBytes only. Keeps the UI from
 *  blinking "not downloaded" while OPFS is being inspected at cold start.
 *  inFlight is ephemeral on purpose. */
export const useOfflineStore = create<OfflineState>()(
  persist(
    (set) => ({
      downloaded: [],
      inFlight: {},
      totalBytes: 0,
      hydrated: false,

      setHydration: ({ downloaded, totalBytes }) =>
        set({ downloaded, totalBytes, hydrated: true }),

      beginDownload: (playlistId, total) =>
        set((s) => ({
          inFlight: { ...s.inFlight, [playlistId]: { current: 0, total, trackTitle: '' } },
        })),

      updateProgress: (playlistId, current, trackTitle) =>
        set((s) => {
          const prev = s.inFlight[playlistId];
          if (!prev) return s;
          return {
            inFlight: { ...s.inFlight, [playlistId]: { ...prev, current, trackTitle } },
          };
        }),

      finishDownload: (playlistId, bytesAdded) =>
        set((s) => {
          const { [playlistId]: _drop, ...rest } = s.inFlight;
          void _drop;
          return {
            inFlight: rest,
            downloaded: s.downloaded.includes(playlistId)
              ? s.downloaded
              : [...s.downloaded, playlistId],
            totalBytes: s.totalBytes + bytesAdded,
          };
        }),

      failDownload: (playlistId) =>
        set((s) => {
          const { [playlistId]: _drop, ...rest } = s.inFlight;
          void _drop;
          return { inFlight: rest };
        }),

      removeDownload: (playlistId, bytesRemoved) =>
        set((s) => ({
          downloaded: s.downloaded.filter((id) => id !== playlistId),
          totalBytes: Math.max(0, s.totalBytes - bytesRemoved),
        })),
    }),
    {
      name: 'ember.offline.v1',
      partialize: (s) => ({
        downloaded: s.downloaded,
        totalBytes: s.totalBytes,
      }),
    },
  ),
);
