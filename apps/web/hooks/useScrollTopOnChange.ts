'use client';

import { useEffect } from 'react';

/** Scrolls the shell's page scroller back to the top whenever `key` changes
 *  (entering or leaving a row's "Show all" view). Done at once and across two
 *  animation frames, since new content can shift the layout after first paint. */
export function useScrollTopOnChange(key: unknown) {
  useEffect(() => {
    const scroller = document.querySelector<HTMLElement>('[data-app-scroller]');
    if (!scroller) return;
    const reset = () => { scroller.scrollTop = 0; };
    reset();
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      reset();
      raf2 = requestAnimationFrame(reset);
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, [key]);
}
