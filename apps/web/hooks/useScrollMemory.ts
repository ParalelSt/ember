'use client';

import { useLayoutEffect } from 'react';

/** Where the app's scroller was, per URL (path plus query), for this tab. */
const positions = new Map<string, number>();

/** A Back or Forward only counts for a short while, and never past the next
 *  tap or key press: otherwise a later fresh visit would be "restored". */
const POP_WINDOW_MS = 3000;
let poppedAt = 0;

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => { poppedAt = Date.now(); });
  const forget = () => { poppedAt = 0; };
  window.addEventListener('pointerdown', forget, true);
  window.addEventListener('keydown', forget, true);
}

/** Test hook: forget every saved position and any pending Back. */
export function resetScrollMemory() {
  positions.clear();
  poppedAt = 0;
}

/** Test hook: act as if the browser just went Back or Forward. */
export function markPopForTest() {
  poppedAt = Date.now();
}

const MAX_FRAMES = 40;

/** Remembers the app scroller's position for `key` (the page's full URL) and
 *  puts it back when the user comes back to that URL with Back or Forward.
 *  A fresh visit (a tab tap, a new search) is left at the top. The browser's
 *  own restoration does nothing here because the app scrolls inside
 *  [data-app-scroller], not the window. */
export function useScrollMemory(key: string) {
  useLayoutEffect(() => {
    const scroller = document.querySelector<HTMLElement>('[data-app-scroller]');
    if (!scroller) return;

    const target = Date.now() - poppedAt < POP_WINDOW_MS ? positions.get(key) : undefined;
    poppedAt = 0;
    let restoring = target !== undefined && target > 0;
    let raf = 0;
    const stop = () => {
      restoring = false;
      cancelAnimationFrame(raf);
    };

    if (restoring) {
      // Results can render a frame or two late, so the content may not be
      // tall enough yet: retry until it sticks or the user takes over.
      let frames = 0;
      const attempt = () => {
        if (!restoring) return;
        scroller.scrollTop = target as number;
        frames += 1;
        if (Math.abs(scroller.scrollTop - (target as number)) <= 1 || frames >= MAX_FRAMES) {
          restoring = false;
          return;
        }
        raf = requestAnimationFrame(attempt);
      };
      attempt();
    }

    // The scroll events the shell's reset and our own restore cause must not
    // overwrite the saved spot.
    const onScroll = () => {
      if (!restoring) positions.set(key, scroller.scrollTop);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    scroller.addEventListener('wheel', stop, { passive: true });
    scroller.addEventListener('touchstart', stop, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      scroller.removeEventListener('wheel', stop);
      scroller.removeEventListener('touchstart', stop);
      cancelAnimationFrame(raf);
    };
  }, [key]);
}
