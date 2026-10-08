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
  /** Transient, when set to 'lyrics', the NowPlaying overlay scrolls
   *  to its lyrics section on next render, then clears the flag. */
  nowPlayingFocus: NowPlayingFocus;
  setNowPlayingFocus: (focus: NowPlayingFocus) => void;
  /** "Scan QR code" (QrScanHost, ephemeral): 'native' asks the Android
   *  app's scanner first, 'web' shows the page's own scanner full screen. */
  qrScan: 'idle' | 'native' | 'web';
  setQrScan: (qrScan: 'idle' | 'native' | 'web') => void;
  /** A short code scanned from a QR, waiting for Settings > Devices to show
   *  its approve card (DevicesPanel takes it once). Memory only, never the
   *  URL or storage. */
  scannedCode: string | null;
  setScannedCode: (code: string | null) => void;
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
      qrScan: 'idle',
      setQrScan: (qrScan) => set({ qrScan }),
      scannedCode: null,
      setScannedCode: (scannedCode) => set({ scannedCode }),
    }),
    {
      name: 'ember.ui.v1',
      partialize: (s) => ({ lyricsOpen: s.lyricsOpen }),
    },
  ),
);
