'use client';

import { useEffect, useRef, useState } from 'react';

/** How far `ref`'s element sits below the top of the app's page scroller
 *  (`[data-app-scroller]`), in px, measured as if the page were scrolled to
 *  the top. With `--ember-scroller-h` (the scroller's visible height, set by
 *  the app layout) it lets a block fill exactly what is left of the window
 *  under the page heading (Settings > Appearance, bughunt F2). Null until
 *  measured, or when the element is not inside the scroller. Kept current
 *  when the scroller or the page column resizes (a window resize, the player
 *  bar appearing, a heading wrapping). */
export function useScrollerOffset<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [offset, setOffset] = useState<number | null>(null);

  useEffect(() => {
    const el = ref.current;
    const scroller = el?.closest<HTMLElement>('[data-app-scroller]');
    if (!el || !scroller) return;
    const update = () => {
      const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      setOffset(Math.round(top));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(scroller);
    const column = el.closest('main');
    if (column) ro.observe(column);
    return () => ro.disconnect();
  }, []);

  return [ref, offset] as const;
}
