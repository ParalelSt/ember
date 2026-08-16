'use client';

import { create } from 'zustand';
import { api } from '@/lib/api';

/** The two "don't broadcast what I'm playing" switches.
 *
 *  Deliberately NOT persisted to localStorage: the server is the source of
 *  truth, and a cached "yes you're sharing" surviving a sign-out on a shared
 *  machine is exactly the wrong failure. Until the fetch lands we assume NOT
 *  sharing — erring toward silence rather than broadcasting for someone who
 *  opted out. */
interface PrivacyState {
  shareDiscord: boolean;
  shareListening: boolean;
  loaded: boolean;
  load: () => Promise<void>;
  set: (patch: { shareDiscord?: boolean; shareListening?: boolean }) => Promise<void>;
}

export const usePrivacyStore = create<PrivacyState>((set) => ({
  shareDiscord: false,
  shareListening: false,
  loaded: false,

  load: async () => {
    try {
      const s = await api.getPrivacy();
      set({ shareDiscord: s.shareDiscord, shareListening: s.shareListening, loaded: true });
    } catch {
      // Leave the safe defaults in place; the settings page shows the real
      // values once it can reach the server.
      set({ loaded: true });
    }
  },

  set: async (patch) => {
    const saved = await api.updatePrivacy(patch);
    set({ shareDiscord: saved.shareDiscord, shareListening: saved.shareListening, loaded: true });
  },
}));
