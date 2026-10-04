'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent, PointerEvent } from 'react';

export const HOLD_MS = 450;

/** Long-press on touch, right-click on desktop: both call `onHold(id)`. The
 *  tap that ends a hold must not also open the link, so the row's click
 *  handler asks `consumeHold()` and cancels itself when it returns true. */
export function useHold(onHold: (id: string) => void) {
  const timer = useRef<number | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const held = useRef(false);

  const clear = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => clear, [clear]);

  const props = (id: string) => ({
    onPointerDown: (e: PointerEvent) => {
      held.current = false;
      if (e.button !== 0) return;
      start.current = { x: e.clientX, y: e.clientY };
      clear();
      timer.current = window.setTimeout(() => {
        held.current = true;
        timer.current = null;
        onHold(id);
      }, HOLD_MS);
    },
    onPointerMove: (e: PointerEvent) => {
      const s = start.current;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) > 8) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e: MouseEvent) => {
      e.preventDefault();
      // A touch hold also fires contextmenu: the timer already has it.
      if (held.current) return;
      clear();
      held.current = true;
      onHold(id);
    },
  });

  /** True once if the click now arriving ends a hold. */
  const consumeHold = () => {
    const was = held.current;
    held.current = false;
    return was;
  };
  return { props, consumeHold };
}
