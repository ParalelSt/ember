'use client';

import { create } from 'zustand';
import { api } from '@/lib/api';
import { APP_VERSION, CHANGELOG } from '@/lib/changelog';
import { isNewer } from '@/lib/semver';

/** Per-user "What's new" read state. Not persisted: PocketBase is the source
 *  of truth so it follows the user across devices (docs/changelog-system.md).
 *  Until the fetch lands, seenVersion stays null and nothing is New. */
interface ChangelogStoreState {
  /** The app version last marked read. null = not known yet. */
  seenVersion: string | null;
  hideNew: boolean;
  /** Entries opened one by one (above seenVersion but no longer New). */
  readIds: string[];
  loaded: boolean;
  load: () => Promise<void>;
  markAllRead: () => Promise<void>;
  /** Mark one entry read, e.g. when the user opens it. */
  markRead: (id: string) => Promise<void>;
  setHideNew: (hide: boolean) => Promise<void>;
}

export const useChangelogStore = create<ChangelogStoreState>((set, get) => ({
  seenVersion: null,
  hideNew: false,
  readIds: [],
  loaded: false,

  load: async () => {
    try {
      const s = await api.getChangelog();
      if (!s.seenVersion) {
        // Brand new user, or the first build with this feature: start them at
        // the current version so nothing is New and history stays browsable.
        set({ seenVersion: APP_VERSION, hideNew: s.hideNew, readIds: [], loaded: true });
        await api.updateChangelog({ seenVersion: APP_VERSION }).catch(() => {
          // Nothing New either way; the next load simply tries again.
        });
        return;
      }
      set({ seenVersion: s.seenVersion, hideNew: s.hideNew, readIds: s.readIds ?? [], loaded: true });
    } catch {
      // Leave seenVersion unknown: nothing shows as New rather than
      // everything flashing because the server could not be reached.
      set({ loaded: true });
    }
  },

  markAllRead: async () => {
    const { seenVersion: prev, readIds: prevIds } = get();
    set({ seenVersion: APP_VERSION, readIds: [] });
    try {
      const saved = await api.updateChangelog({ seenVersion: APP_VERSION, readIds: [] });
      set({ seenVersion: saved.seenVersion || APP_VERSION, hideNew: saved.hideNew, readIds: saved.readIds ?? [] });
    } catch {
      set({ seenVersion: prev, readIds: prevIds });
    }
  },

  markRead: async (id) => {
    const { seenVersion, readIds: prev } = get();
    if (!seenVersion || prev.includes(id)) return;
    // Keep only ids that are still above seenVersion: older ones are read
    // already, so the list stays small.
    const above = new Set(CHANGELOG.filter((e) => isNewer(e.version, seenVersion)).map((e) => e.id));
    if (!above.has(id)) return;
    const next = [...prev, id].filter((x) => above.has(x));
    set({ readIds: next });
    try {
      const saved = await api.updateChangelog({ readIds: next });
      set({ readIds: saved.readIds ?? next });
    } catch {
      set({ readIds: prev });
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
