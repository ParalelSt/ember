'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { api } from '@/lib/api';
import { DEFAULT_THEME, parseThemeDoc, sameDoc, type ThemeDoc } from '@/lib/theme/model';
import { docFromPreset, type ThemeSelection } from '@/lib/theme/saved';

/** The active theme (Settings > Appearance), following the account the same
 *  way the plugin switches in useSettingsStore do: the account is the
 *  truth, this device's localStorage (`ember.theme.v1`) is a cache, and the
 *  pb_auth cookie carries a third copy so the root layout paints the right
 *  colours in the first HTML byte. After every change the cookie is
 *  rewritten through the writer AuthProvider registers, so a hard reload
 *  straight after a change is already right. */
interface ThemeState {
  /** The active theme. Persisted. */
  doc: ThemeDoc;
  /** An unsaved draft the Appearance page is showing live (colours being
   *  dragged, a theme that fails the readability guard). Wins over `doc` on
   *  the page while set. Not persisted. */
  preview: ThemeDoc | null;
  setPreview: (doc: ThemeDoc | null) => void;

  /** Make a preset or a saved theme (mine or shared) the active one.
   *  Optimistic: a preset applies at once, a saved theme too when the
   *  caller passes the doc it expects (`docFromSaved` of the list row).
   *  Rolls back if the save fails, unless something newer replaced it.
   *  Resolves to the stored doc, or null when the save failed. */
  select: (selection: ThemeSelection, optimistic?: ThemeDoc) => Promise<ThemeDoc | null>;
  /** Take an active doc a /api/themes call returned (my active theme was
   *  edited or deleted) and refresh the cookie with it. */
  adopt: (doc: ThemeDoc) => void;

  /** The signed-in user the theme is synced with. Not persisted. */
  userId: string | null;
  /** True once the account's theme has landed. Not persisted. */
  loaded: boolean;
  /** Pull the account's active theme, once per user id. */
  loadTheme: (userId: string) => Promise<void>;
  /** Sign-out: stop syncing and drop any draft. The cached doc stays so the
   *  theme is back the moment the person signs in again; signed-out pages
   *  show Ember regardless (ThemeApplier). */
  resetThemeSync: () => void;
  /** The theme the server painted from the cookie record, once on mount.
   *  A known server doc wins over this device's cache; null (signed out,
   *  or a record stripped for size) leaves the cache. */
  hydrateFromServer: (doc: ThemeDoc | null) => void;
}

type CookieWriter = (doc: ThemeDoc) => void;
let cookieWriter: CookieWriter | null = null;

/** AuthProvider owns the one PocketBase client; it registers how to put a
 *  theme into the auth record so the store never makes a second client. */
export function registerThemeCookieWriter(writer: CookieWriter | null): void {
  cookieWriter = writer;
}

function writeCookie(doc: ThemeDoc): void {
  try {
    cookieWriter?.(doc);
  } catch {
    // The account already has it; the cookie catches up on the next
    // navigation (proxy.ts refreshes the record on every request).
  }
}

/** A selection made while a load was in flight: the load must not
 *  overwrite it, its own PATCH carries the newer value. */
let editedDuringLoad = false;

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      doc: DEFAULT_THEME,
      preview: null,
      setPreview: (preview) => set({ preview }),

      select: async (selection, optimistic) => {
        const prev = get().doc;
        const guess = 'preset' in selection ? docFromPreset(selection.preset) : optimistic;
        editedDuringLoad = true;
        if (guess) set({ doc: guess });
        const userId = get().userId;
        if (!userId) return guess ?? null;
        try {
          const saved = await api.setTheme(selection);
          if (get().userId !== userId) return saved;
          // Something newer replaced the guess while the save was in flight:
          // leave it, its own save carries it.
          if (!guess || sameDoc(get().doc, guess)) set({ doc: saved });
          writeCookie(saved);
          return saved;
        } catch {
          if (get().userId === userId && guess && sameDoc(get().doc, guess)) set({ doc: prev });
          return null;
        }
      },

      adopt: (doc) => {
        editedDuringLoad = true;
        set({ doc });
        writeCookie(doc);
      },

      userId: null,
      loaded: false,

      loadTheme: async (userId) => {
        if (get().userId === userId) return;
        editedDuringLoad = false;
        set({ userId, loaded: false });
        let stored: ThemeDoc;
        try {
          stored = await api.getTheme();
        } catch {
          // Offline or the server is down: keep the cached theme.
          return;
        }
        if (get().userId !== userId) return;
        if (!editedDuringLoad) {
          set({ doc: stored });
          writeCookie(stored);
        }
        set({ loaded: true });
      },

      resetThemeSync: () => {
        editedDuringLoad = false;
        set({ userId: null, loaded: false, preview: null });
      },

      hydrateFromServer: (doc) => {
        if (doc && !sameDoc(doc, get().doc)) set({ doc });
      },
    }),
    {
      name: 'ember.theme.v1',
      // Only the doc: sync state and drafts belong to this page load.
      partialize: (s) => ({ doc: s.doc }),
      // Whatever localStorage holds goes through the same parser as the
      // account's value, so a hand-edited or stale cache cannot break paint.
      merge: (persisted, current) => ({
        ...current,
        doc: parseThemeDoc((persisted as { doc?: unknown } | undefined)?.doc),
      }),
    },
  ),
);
