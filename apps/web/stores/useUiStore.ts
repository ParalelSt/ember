'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** UI flags. lyricsOpen is persisted so the panel stays open across reloads
 *  (Spotify behavior); bugReportOpen and searchOpen are ephemeral so they
 *  don't auto-show. */
type NowPlayingFocus = 'lyrics' | null;

interface UiState {
  bugReportOpen: boolean;
  setBugReportOpen: (open: boolean) => void;
  /** Drives the search overlay in the app shell (components/search). Lives
   *  in the shell's own state, not the URL, so opening it is instant even
   *  with no network: no route change, no chunk to wait for. */
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
  /** Desktop-only: drives the inline LyricsPanel. Mobile uses the
   *  NowPlaying overlay's lyrics section instead. */
  lyricsOpen: boolean;
  setLyricsOpen: (open: boolean) => void;
  /** Transient — when set to 'lyrics', the NowPlaying overlay scrolls
   *  to its lyrics section on next render, then clears the flag. */
  nowPlayingFocus: NowPlayingFocus;
  setNowPlayingFocus: (focus: NowPlayingFocus) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      bugReportOpen: false,
      setBugReportOpen: (bugReportOpen) => set({ bugReportOpen }),
      searchOpen: false,
      setSearchOpen: (searchOpen) => set({ searchOpen }),
      lyricsOpen: false,
      setLyricsOpen: (lyricsOpen) => set({ lyricsOpen }),
      nowPlayingFocus: null,
      setNowPlayingFocus: (nowPlayingFocus) => set({ nowPlayingFocus }),
    }),
    {
      name: 'ember.ui.v1',
      partialize: (s) => ({ lyricsOpen: s.lyricsOpen }),
    },
  ),
);
