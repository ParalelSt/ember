'use client';

import { useEffect, type RefObject } from 'react';

/** Scrolls the frame's own content column (not the /dizajn page) so `ref`
 *  sits near its top, once, when `active`. A phone frame shows about three
 *  rows under the playlist header; a selecting step wants the list in view.
 *  Walks offsetTop up to the scroller, so the frame's scale() transform does
 *  not skew it. */
export function useFrameScroll(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const scroller = el.closest('.overflow-y-auto');
    if (!(scroller instanceof HTMLElement)) return;
    let y = 0;
    let node: HTMLElement | null = el;
    while (node && node !== scroller) {
      y += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    scroller.scrollTop = Math.max(0, y - 8);
    // Once, on mount: the step picker remounts the frame for a new step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
