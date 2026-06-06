'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** UI flags. lyricsOpen is persisted so the panel stays open across reloads
 *  (Spotify behavior); bugReportOpen is ephemeral so it doesn't auto-show. */
interface UiState {
  bugReportOpen: boolean;
  setBugReportOpen: (open: boolean) => void;
  lyricsOpen: boolean;
  setLyricsOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      bugReportOpen: false,
      setBugReportOpen: (bugReportOpen) => set({ bugReportOpen }),
      lyricsOpen: false,
      setLyricsOpen: (lyricsOpen) => set({ lyricsOpen }),
    }),
    {
      name: 'ember.ui.v1',
      partialize: (s) => ({ lyricsOpen: s.lyricsOpen }),
    },
  ),
);
