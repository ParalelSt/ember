'use client';

import { create } from 'zustand';
import type { UpdateOffer } from '@/lib/update/check';

/** Where "is there a newer Ember" stands on this device (lib/update/check.ts),
 *  shared by the update reminder and Settings' Updates card. Not persisted:
 *  every app start asks again. */
export interface UpdateState {
  status: 'idle' | 'checking' | 'up-to-date' | 'available' | 'failed';
  offer: UpdateOffer | null;
  webLatest: string | null;
  shellLatest: string | null;
  checkedAt: number;
  /** Tapped while a song plays: the update waits for the song to end. */
  pending: boolean;
  /** The update is going in (the page reloads, or the app restarts). */
  applying: boolean;
  /** The app could not restart itself (a desktop app from before
   *  update_restart): quit and reopen it instead. */
  applyFailed: boolean;
  set: (patch: Partial<Omit<UpdateState, 'set'>>) => void;
}

export const INITIAL_UPDATE_STATE = {
  status: 'idle',
  offer: null,
  webLatest: null,
  shellLatest: null,
  checkedAt: 0,
  pending: false,
  applying: false,
  applyFailed: false,
} as const satisfies Omit<UpdateState, 'set'>;

export const useUpdateStore = create<UpdateState>()((set) => ({
  ...INITIAL_UPDATE_STATE,
  set: (patch) => set(patch),
}));
