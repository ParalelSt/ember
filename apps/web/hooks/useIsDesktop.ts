'use client';

import { useSyncExternalStore } from 'react';

/** Tailwind's `md` breakpoint, the one the whole shell already splits on
 *  (Sidebar is `hidden md:flex`, TopBar and MobileNav are `md:hidden`). */
const DESKTOP = '(min-width: 768px)';

function subscribe(onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mql = window.matchMedia(DESKTOP);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

function getSnapshot(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia(DESKTOP).matches;
}

/** The server has no window, so it renders the phone answer; the client
 *  corrects it on its first commit. Nothing that reads this is on screen
 *  during hydration (the search overlay starts closed), so the correction
 *  is never visible. */
function getServerSnapshot(): boolean {
  return false;
}

/** True on an `md` and wider window. A real media query rather than `md:`
 *  classes, for the one case classes cannot cover: picking a different
 *  COMPONENT per size. The search overlay is a non-modal dropdown on a
 *  desktop window and a modal full-screen sheet on a phone, and rendering
 *  both with one hidden by CSS would put two search inputs, two focus
 *  targets and two copies of every result row in the page at once. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
