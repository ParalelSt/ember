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
  /** Silent crash reports (lib/autoReport.ts): on by default so hosts learn
   *  about crashes nobody bothered to report by hand. Checked on every
   *  error-level log entry, not just at Settings-page render time. */
  autoReportEnabled: boolean;
  setAutoReportEnabled: (on: boolean) => void;
  /** Guitar tabs plugin (Songsterr integration): the tabs button in the
   *  player bar and Now Playing, and the /tabs/[trackId] page itself. On by
   *  default so nobody who already uses tabs loses them on update. */
  tabsEnabled: boolean;
  setTabsEnabled: (on: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      partyVolume: false,
      setPartyVolume: (partyVolume) => set({ partyVolume }),
      autoReportEnabled: true,
      setAutoReportEnabled: (autoReportEnabled) => set({ autoReportEnabled }),
      tabsEnabled: true,
      setTabsEnabled: (tabsEnabled) => set({ tabsEnabled }),
    }),
    { name: 'ember.settings.v1' },
  ),
);
