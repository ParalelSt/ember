'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { NativeStatus, PinStatus } from '@/lib/offlineNative';

export interface InFlight {
  current: number;
  total: number;
  trackTitle: string;
}

interface OfflineState {
  /** Playlist IDs (or LIKED_PIN) with a complete download: OPFS on the web,
   *  or a native pin whose done count equals its total. */
  downloaded: string[];
  /** In-flight downloads keyed by playlist id — ephemeral. */
  inFlight: Record<string, InFlight>;
  /** Sum of bytes across all downloaded playlists. */
  totalBytes: number;
  /** True once boot hydration (OPFS meta.json, or the native plugin's first
   *  status()) has finished. */
  hydrated: boolean;
  /** Native pins as last reported by the EmberOffline plugin. Empty on web. */
  pins: PinStatus[];
  /** trackId -> absolute local file path, as reported by the native plugin. */
  trackFiles: Record<string, string>;

  setHydration: (input: { downloaded: string[]; totalBytes: number }) => void;
  beginDownload: (playlistId: string, total: number) => void;
  updateProgress: (playlistId: string, current: number, trackTitle: string) => void;
  finishDownload: (playlistId: string, bytesAdded: number) => void;
  failDownload: (playlistId: string) => void;
  removeDownload: (playlistId: string, bytesRemoved: number) => void;
  /** Replaces the native slice wholesale from a plugin status/event, and
   *  derives `downloaded` + `inFlight` from the pins so playlist/Liked pages
   *  don't need their own bookkeeping for the native path. */
  setNativeStatus: (s: NativeStatus) => void;
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
      pins: [],
      trackFiles: {},

      setHydration: ({ downloaded, totalBytes }) =>
        set({ downloaded, totalBytes, hydrated: true }),

      setNativeStatus: (s) =>
        set({
          pins: s.pins,
          trackFiles: s.trackFiles,
          totalBytes: s.totalBytes,
          hydrated: true,
          downloaded: s.pins.filter((p) => p.total > 0 && p.done === p.total).map((p) => p.id),
          inFlight: Object.fromEntries(
            s.pins
              .filter((p) => p.downloading || (p.done < p.total && p.failed === 0))
              .map((p) => [p.id, { current: p.done, total: p.total, trackTitle: s.progress?.id === p.id ? s.progress.title : '' }]),
          ),
        }),

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
        pins: s.pins,
        trackFiles: s.trackFiles,
      }),
    },
  ),
);
