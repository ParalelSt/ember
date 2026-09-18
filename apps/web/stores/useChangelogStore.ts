'use client';

import { create } from 'zustand';
import { api } from '@/lib/api';
import { APP_VERSION } from '@/lib/changelog';

/** Per-user "What's new" read state. Not persisted: PocketBase is the source
 *  of truth so it follows the user across devices (docs/changelog-system.md).
 *  Until the fetch lands, seenVersion stays null and nothing is New. */
interface ChangelogStoreState {
  /** The app version last marked read. null = not known yet. */
  seenVersion: string | null;
  hideNew: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  markAllRead: () => Promise<void>;
  setHideNew: (hide: boolean) => Promise<void>;
}

export const useChangelogStore = create<ChangelogStoreState>((set, get) => ({
  seenVersion: null,
  hideNew: false,
  loaded: false,

  load: async () => {
    try {
      const s = await api.getChangelog();
      if (!s.seenVersion) {
        // Brand new user, or the first build with this feature: start them at
        // the current version so nothing is New and history stays browsable.
        set({ seenVersion: APP_VERSION, hideNew: s.hideNew, loaded: true });
        await api.updateChangelog({ seenVersion: APP_VERSION }).catch(() => {
          // Nothing New either way; the next load simply tries again.
        });
        return;
      }
      set({ seenVersion: s.seenVersion, hideNew: s.hideNew, loaded: true });
    } catch {
      // Leave seenVersion unknown: nothing shows as New rather than
      // everything flashing because the server could not be reached.
      set({ loaded: true });
    }
  },

  markAllRead: async () => {
    const prev = get().seenVersion;
    set({ seenVersion: APP_VERSION });
    try {
      const saved = await api.updateChangelog({ seenVersion: APP_VERSION });
      set({ seenVersion: saved.seenVersion || APP_VERSION, hideNew: saved.hideNew });
    } catch {
      set({ seenVersion: prev });
    }
  },

  setHideNew: async (hide) => {
    const prev = get().hideNew;
    set({ hideNew: hide });
    try {
      const saved = await api.updateChangelog({ hideNew: hide });
      set({ hideNew: saved.hideNew });
    } catch {
      set({ hideNew: prev });
    }
  },
}));
