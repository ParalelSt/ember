'use client';

import { useEffect } from 'react';
import { useAuth } from '@/components/providers/AuthProvider';
import { useThemeStore } from '@/stores/useThemeStore';
import { applyToDocument } from '@/lib/theme/css';
import { notifyShell, shellTheme, SHELL_NOTIFY_DELAY_MS } from '@/lib/theme/native';
import { DEFAULT_THEME, sameDoc, type ThemeDoc } from '@/lib/theme/model';
import { logger } from '@/lib/logger/client';

/** Keeps the live page in step with the theme store: the only writer of the
 *  theme on <html> after the server's first paint (lib/theme/css.ts does
 *  the writing), and the one caller of notifyShell, so the Android bars
 *  and the desktop window follow whatever the page shows. Signed out, the
 *  page is Ember whatever this device has cached, so one friend's theme
 *  never colours the sign-in page on a shared computer. Renders nothing.
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
    let shellTimer: ReturnType<typeof setTimeout> | undefined;
    const apply = () => {
      const { preview, doc } = useThemeStore.getState();
      const shown = signedIn ? (preview ?? doc) : DEFAULT_THEME;
      if (last && sameDoc(last, shown)) return;
      last = shown;
      applyToDocument(shown);
      // The shell's chrome follows once the page settles (lib/theme/native.ts).
      clearTimeout(shellTimer);
      shellTimer = setTimeout(() => notifyShell(shellTheme(shown)), SHELL_NOTIFY_DELAY_MS);
    };
    apply();
    const unsubscribe = useThemeStore.subscribe(apply);
    return () => {
      unsubscribe();
      clearTimeout(shellTimer);
    };
  }, [signedIn]);

  return null;
}
