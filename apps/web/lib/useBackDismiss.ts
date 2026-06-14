'use client';

import { useEffect } from 'react';

/** While `isOpen`, makes the hardware/browser Back button call `close()`
 *  instead of navigating away. Pushes a same-URL history entry on open and
 *  pops it on a back press; if the overlay is instead closed by the UI
 *  (chevron / Escape), the leftover entry is discarded on cleanup so Back
 *  never needs two presses and no trap is created. The same-URL push avoids
 *  any real navigation — Next's App Router sees the same route on popstate, so
 *  only our handler runs. `close` must be stable (wrap in useCallback). */
export function useBackDismiss(isOpen: boolean, close: () => void): void {
  useEffect(() => {
    if (typeof window === 'undefined' || !isOpen) return;

    // Marker lets cleanup distinguish "closed by Back" (browser already popped
    // our entry, marker gone) from "closed by UI" (marker still current).
    const MARK = '__emberOverlay';
    window.history.pushState({ [MARK]: true }, '', window.location.href);

    const onPop = () => close();
    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('popstate', onPop);
      // Closed by the UI, not Back → our pushed entry is still current; pop it
      // so history stays clean. (Removing the listener first means this
      // programmatic back can't re-trigger onPop.)
      if ((window.history.state as Record<string, unknown> | null)?.[MARK]) {
        window.history.back();
      }
    };
  }, [isOpen, close]);
}
