'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { flushNativeCookies } from '@/lib/nativeCookies';
import { uiModeFromCookieHeader, type UiMode } from '@/lib/uiMode';

/** This device's look (lib/uiMode): the redesign or the Classic look. The
 *  root layout reads the cookie on the server and hands it in, so the first
 *  HTML already is the right UI. */
interface UiModeValue {
  mode: UiMode;
  /** Asks the server to switch this device's look, then reloads the page so
   *  the other UI renders from the first byte. Rejects when the server could
   *  not be reached (the caller says so); nothing changes then. */
  setMode: (mode: UiMode) => Promise<void>;
}

const UiModeContext = createContext<UiModeValue | null>(null);

/** Test seam: the hard reload after a switch. */
export const uiModeReload = { reload: () => window.location.reload() };

export async function requestUiMode(mode: UiMode): Promise<void> {
  const res = await fetch('/api/ui-mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw new Error(`Could not switch the look (${res.status})`);
}

export function UiModeProvider({ mode, children }: { mode: UiMode; children: ReactNode }) {
  const setMode = useCallback(async (next: UiMode) => {
    await requestUiMode(next);
    // The phone app writes cookies to disk only every ~30 s: an app killed
    // sooner would come back in the other look. Never throws.
    await flushNativeCookies();
    uiModeReload.reload();
  }, []);

  // Back/forward cache: a page restored from it keeps the look it was
  // rendered with, even after the device switched in another tab or before
  // navigating back. When the cookie now says otherwise, render afresh.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      const cookie = uiModeFromCookieHeader(document.cookie);
      const shown = document.documentElement.dataset.ui;
      if (cookie && shown && cookie !== shown) uiModeReload.reload();
    };
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <UiModeContext.Provider value={value}>{children}</UiModeContext.Provider>;
}

/** The device's look. Outside the provider (a test rendering a bare page)
 *  it is the new look, and switching is refused. */
export function useUiMode(): UiModeValue {
  return (
    useContext(UiModeContext) ?? {
      mode: 'new',
      setMode: async () => {
        throw new Error('No UiModeProvider');
      },
    }
  );
}
