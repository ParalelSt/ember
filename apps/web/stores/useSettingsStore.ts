'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '@/lib/api';
import { PLUGIN_KEYS, type PluginKey, type StoredPlugins } from '@/lib/pluginSettings';

/** Persisted user-level toggles. Anything that changes how the app
 *  behaves between sessions lives here so the choice survives reloads.
 *
 *  Plugin switches (partyVolume, tabsEnabled, normalizeVolume) also follow
 *  the account: when signed in, AuthProvider calls loadPlugins and the
 *  account's values win over this device's cache. localStorage stays as that cache, so the UI
 *  does not flicker on load and still reads right offline or signed out.
 *  autoReportEnabled and the auto cache switches are per device only. */
interface SettingsState {
  /** Party-size volume slider plugin: widens the slider and lifts the
   *  audio cap from 0.85 to 1.0 with a linear curve. Off by default; the
   *  normal player uses a gentler power-1.5 curve. */
  partyVolume: boolean;
  setPartyVolume: (on: boolean) => Promise<void>;
  /** Silent crash reports (lib/autoReport.ts): on by default so hosts learn
   *  about crashes nobody bothered to report by hand. Checked on every
   *  error-level log entry, not just at Settings-page render time. */
  autoReportEnabled: boolean;
  setAutoReportEnabled: (on: boolean) => void;
  /** Guitar tabs plugin (Songsterr integration): the tabs button in the
   *  player bar and Now Playing, and the /tabs/[trackId] page itself. On by
   *  default so nobody who already uses tabs loses them on update. */
  tabsEnabled: boolean;
  setTabsEnabled: (on: boolean) => Promise<void>;
  /** Volume normalization (lib/playback/normalization): each song plays at
   *  about the same loudness, using the gain the server measured for it. On
   *  by default. */
  normalizeVolume: boolean;
  setNormalizeVolume: (on: boolean) => Promise<void>;
  /** Quietly save the current song and the next two on this device, so a
   *  dropped connection does not stop the music (hooks/player/useAutoCache).
   *  Per device, not synced: it is about this device's storage and network. */
  autoCacheEnabled: boolean;
  setAutoCacheEnabled: (on: boolean) => void;
  /** Let the auto cache run on mobile data too. Off by default. */
  autoCacheOnMetered: boolean;
  setAutoCacheOnMetered: (on: boolean) => void;

  /** The signed-in user the plugin switches are synced with (null when
   *  signed out: toggles then stay on this device). Not persisted. */
  pluginsUserId: string | null;
  /** True once the account's values have been applied. Not persisted. */
  pluginsLoaded: boolean;
  /** Pull the account's switches, once per user id. Keys the account has
   *  never stored are written up from this device (first device wins). */
  loadPlugins: (userId: string) => Promise<void>;
  /** Sign-out: stop syncing; the cached values stay as the local fallback. */
  resetPluginSync: () => void;
}

/** Plugin keys toggled while a load was in flight: the load must not
 *  overwrite them, their own PATCH carries the newer value. */
const editedDuringLoad = new Set<PluginKey>();

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => {
      /** Optimistic: flip locally, save to the account, roll back if the
       *  save fails (unless something newer has replaced the value). */
      const savePlugin = async (key: PluginKey, on: boolean) => {
        const prev = get()[key];
        editedDuringLoad.add(key);
        set({ [key]: on } as Pick<SettingsState, PluginKey>);
        const userId = get().pluginsUserId;
        if (!userId) return;
        try {
          await api.updatePlugins({ [key]: on });
        } catch {
          if (get().pluginsUserId === userId && get()[key] === on) {
            set({ [key]: prev } as Pick<SettingsState, PluginKey>);
          }
        }
      };

      return {
        partyVolume: false,
        setPartyVolume: (on) => savePlugin('partyVolume', on),
        autoReportEnabled: true,
        setAutoReportEnabled: (autoReportEnabled) => set({ autoReportEnabled }),
        tabsEnabled: true,
        setTabsEnabled: (on) => savePlugin('tabsEnabled', on),
        normalizeVolume: true,
        setNormalizeVolume: (on) => savePlugin('normalizeVolume', on),
        autoCacheEnabled: true,
        setAutoCacheEnabled: (autoCacheEnabled) => set({ autoCacheEnabled }),
        autoCacheOnMetered: false,
        setAutoCacheOnMetered: (autoCacheOnMetered) => set({ autoCacheOnMetered }),

        pluginsUserId: null,
        pluginsLoaded: false,

        loadPlugins: async (userId) => {
          if (get().pluginsUserId === userId) return;
          editedDuringLoad.clear();
          set({ pluginsUserId: userId, pluginsLoaded: false });
          let stored: StoredPlugins;
          try {
            stored = await api.getPlugins();
          } catch {
            // Offline or the server is down: keep the cached values.
            return;
          }
          if (get().pluginsUserId !== userId) return;

          const fromAccount: StoredPlugins = {};
          const migrate: StoredPlugins = {};
          for (const key of PLUGIN_KEYS) {
            if (editedDuringLoad.has(key)) continue;
            const value = stored[key];
            if (typeof value === 'boolean') fromAccount[key] = value;
            else migrate[key] = get()[key];
          }
          set({ ...fromAccount, pluginsLoaded: true });

          if (Object.keys(migrate).length > 0) {
            // Never saved on the account: this device's value becomes the
            // account's. A failure just means the next load tries again.
            await api.updatePlugins(migrate).catch(() => {});
          }
        },

        resetPluginSync: () => {
          editedDuringLoad.clear();
          set({ pluginsUserId: null, pluginsLoaded: false });
        },
      };
    },
    {
      name: 'ember.settings.v1',
      // Only the values: the sync state belongs to this page load.
      partialize: (s) => ({
        partyVolume: s.partyVolume,
        autoReportEnabled: s.autoReportEnabled,
        tabsEnabled: s.tabsEnabled,
        normalizeVolume: s.normalizeVolume,
        autoCacheEnabled: s.autoCacheEnabled,
        autoCacheOnMetered: s.autoCacheOnMetered,
      }),
    },
  ),
);
