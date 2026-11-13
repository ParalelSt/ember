'use client';

import { useEffect } from 'react';

const MARK = '__emberOverlay';

/** Every open overlay's entry gets its own id, larger than any before it
 *  (time based, so ids left in history by an earlier page load are smaller
 *  too). Overlays can stack (the player over the search sheet), and with
 *  one shared marker a single Back closed every open overlay, each of them
 *  then stepping back once more: the listener landed pages behind where
 *  they were. */
let lastId = 0;
function nextId(): number {
  lastId = Math.max(lastId + 1, Date.now());
  return lastId;
}

/** The overlay id of the entry on screen, or null on a page's own entry. */
function currentMark(): number | null {
  const v = (window.history.state as Record<string, unknown> | null)?.[MARK];
  return typeof v === 'number' ? v : null;
}

/** While `isOpen`, makes the hardware/browser Back button call `close()`
 *  instead of navigating away. Pushes a same-URL history entry on open and
 *  closes when Back leaves it; if the overlay is instead closed by the UI
 *  (chevron / Escape), the leftover entry is discarded on cleanup so Back
 *  never needs two presses and no trap is created. The same-URL push avoids
 *  any real navigation, Next's App Router sees the same route on popstate, so
 *  only our handler runs. `close` must be stable (wrap in useCallback). */
export function useBackDismiss(isOpen: boolean, close: () => void): void {
  useEffect(() => {
    if (typeof window === 'undefined' || !isOpen) return;

    const id = nextId();
    window.history.pushState({ [MARK]: id }, '', window.location.href);

    // Back left this overlay's entry when it lands below it: on a page's
    // entry or on an overlay opened before this one. Landing on this entry
    // (or a later one) means Back closed an overlay on top of this one.
    const onPop = () => {
      const mark = currentMark();
      if (mark === null || mark < id) close();
    };
    window.addEventListener('popstate', onPop);

    return () => {
      window.removeEventListener('popstate', onPop);
      // Closed by the UI, not Back: our pushed entry is still current; pop it
      // so history stays clean. (Removing the listener first means this
      // programmatic back can't re-trigger onPop.) When another overlay's
      // entry is on top, stepping back would close THAT one, so ours stays.
      if (currentMark() === id) window.history.back();
    };
  }, [isOpen, close]);
}
