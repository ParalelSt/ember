'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Credential } from '@/lib/qrLogin/client';

/** A sign-in request this device is asked to approve (ApproveSheetHost).
 *  `n` makes the same code typed twice a new sheet. */
export interface ApproveRequest {
  credential: Credential;
  n: number;
}

/** The device just approved, for Settings > Devices to light up. */
export interface JustApproved {
  id: string;
  device: string;
  sameNetwork: boolean;
  /** When it was approved, ms since the epoch. */
  at: number;
}

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
  /** The approve sheet's request: a QR link's token or a short code, from
   *  Scan QR code or typed in Settings > Devices. Memory only, never the URL
   *  or storage, so the token stays out of history. */
  approveRequest: ApproveRequest | null;
  openApprove: (credential: Credential) => void;
  closeApprove: () => void;
  /** Set by an approval, taken once by Settings > Devices (DevicesPanel). */
  justApproved: JustApproved | null;
  setJustApproved: (device: JustApproved | null) => void;
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
      approveRequest: null,
      openApprove: (credential) => set((s) => ({ approveRequest: { credential, n: (s.approveRequest?.n ?? 0) + 1 } })),
      closeApprove: () => set({ approveRequest: null }),
      justApproved: null,
      setJustApproved: (justApproved) => set({ justApproved }),
    }),
    {
      name: 'ember.ui.v1',
      partialize: (s) => ({ lyricsOpen: s.lyricsOpen }),
    },
  ),
);
