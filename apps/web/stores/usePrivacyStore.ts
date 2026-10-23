'use client';

import { create } from 'zustand';
import { api } from '@/lib/api';

/** The two "don't broadcast what I'm playing" switches.
 *
 *  Deliberately NOT persisted to localStorage: the server is the source of
 *  truth, and a cached "yes you're sharing" surviving a sign-out on a shared
 *  machine is exactly the wrong failure. Until the fetch lands we assume NOT
 *  sharing, erring toward silence rather than broadcasting for someone who
 *  opted out. */
interface PrivacyState {
  shareDiscord: boolean;
  shareListening: boolean;
  loaded: boolean;
  /** The last load could not reach the server: the switches show nothing
   *  real, so they stay off and disabled until a retry lands. */
  failed: boolean;
  load: () => Promise<void>;
  set: (patch: { shareDiscord?: boolean; shareListening?: boolean }) => Promise<void>;
}

/** Bumped by every save: a load that was on its way when the member flipped
 *  a switch read the account from before it, so its answer (or its failure)
 *  is dropped instead of flipping the switch back. */
let saves = 0;

export const usePrivacyStore = create<PrivacyState>((set) => ({
  shareDiscord: false,
  shareListening: false,
  loaded: false,
  failed: false,

  load: async () => {
    const savesAtStart = saves;
    try {
      const s = await api.getPrivacy();
      if (saves !== savesAtStart) return;
      set({ shareDiscord: s.shareDiscord, shareListening: s.shareListening, loaded: true, failed: false });
    } catch {
      if (saves !== savesAtStart) return;
      // Back to the safe defaults (another account's yes may still be here),
      // and not loaded: the settings page says so and offers a retry rather
      // than showing two live switches that do not match the account.
      set({ shareDiscord: false, shareListening: false, loaded: false, failed: true });
    }
  },

  set: async (patch) => {
    saves += 1;
    const saved = await api.updatePrivacy(patch);
    set({ shareDiscord: saved.shareDiscord, shareListening: saved.shareListening, loaded: true, failed: false });
  },
}));
