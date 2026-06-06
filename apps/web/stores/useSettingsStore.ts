'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** Persisted user-level toggles. Anything that changes how the app
 *  behaves between sessions lives here so the choice survives reloads. */
interface SettingsState {
  /** Party-size volume slider plugin — widens the slider and lifts the
   *  audio cap from 0.85 to 1.0 with a linear curve. Off by default; the
   *  normal player uses a gentler power-1.5 curve. */
  partyVolume: boolean;
  setPartyVolume: (on: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      partyVolume: false,
      setPartyVolume: (partyVolume) => set({ partyVolume }),
    }),
    { name: 'ember.settings.v1' },
  ),
);
