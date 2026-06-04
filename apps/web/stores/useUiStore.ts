'use client';

import { create } from 'zustand';

/** Lightweight ephemeral UI state. Kept separate from usePlayerStore so it
 *  doesn't get persisted alongside the queue. */
interface UiState {
  bugReportOpen: boolean;
  setBugReportOpen: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  bugReportOpen: false,
  setBugReportOpen: (bugReportOpen) => set({ bugReportOpen }),
}));
