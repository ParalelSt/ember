'use client';

import { useEffect } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { useThemeStore } from '@/stores/useThemeStore';
import { applyToDocument } from '@/lib/theme/css';
import { DEFAULT_THEME, sameDoc, type ThemeDoc } from '@/lib/theme/model';
import { logger } from '@/lib/logger/client';

/** Keeps the live page in step with the theme store: the only writer of the
 *  theme on <html> after the server's first paint (lib/theme/css.ts does
 *  the writing). Signed out, the page is Ember whatever this device has
 *  cached, so one friend's theme never colours the sign-in page on a
 *  shared computer. Renders nothing.
 *
 *  `initial` is what the root layout painted from the cookie record (null
 *  when signed out); `stripped` means signed in but the SDK dropped the
 *  record from the cookie for size, so the first paint was Ember. */
export function ThemeApplier({ initial, stripped = false }: { initial: ThemeDoc | null; stripped?: boolean }) {
  const { user } = useAuth();
  const signedIn = user !== null;

  // Declared first so it runs before the apply effect below reads the store.
  useEffect(() => {
    useThemeStore.getState().hydrateFromServer(initial);
  }, [initial]);

  useEffect(() => {
    if (stripped) logger.warn('theme', 'cookie record stripped');
  }, [stripped]);

  useEffect(() => {
    let last: ThemeDoc | null = null;
    const apply = () => {
      const { preview, doc } = useThemeStore.getState();
      const shown = signedIn ? (preview ?? doc) : DEFAULT_THEME;
      if (last && sameDoc(last, shown)) return;
      last = shown;
      applyToDocument(shown);
    };
    apply();
    return useThemeStore.subscribe(apply);
  }, [signedIn]);

  return null;
}
