'use client';

import { useRef, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';

/** How far a finger must travel sideways for a swipe to skip. */
export const SWIPE_MIN_PX = 48;

/** What a drag of (dx, dy) px does: left is the next song, right the one
 *  before, like turning a page. Mostly sideways only (a scroll that drifts
 *  is not a skip). */
export function swipeDirection(dx: number, dy: number): 'next' | 'prev' | null {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? 'next' : 'prev';
}

export interface SwipeSkipProps {
  onPointerDown?: (e: PointerEvent) => void;
  onPointerUp?: (e: PointerEvent) => void;
  onPointerCancel?: () => void;
  onClickCapture?: (e: MouseEvent) => void;
  style?: CSSProperties;
}

/** Swipe the cover to skip (the head unit's car controls): spread the
 *  returned props on the element. Nothing when `enabled` is false. A swipe
 *  that ends on a link inside does not also open it. */
export function useSwipeSkip({ onNext, onPrev, enabled }: { onNext: () => void; onPrev: () => void; enabled: boolean }): SwipeSkipProps {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);
  if (!enabled) return {};
  return {
    onPointerDown: (e) => {
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      swiped.current = false;
    },
    onPointerUp: (e) => {
      const s = start.current;
      start.current = null;
      if (!s || s.id !== e.pointerId) return;
      const dir = swipeDirection(e.clientX - s.x, e.clientY - s.y);
      if (!dir) return;
      swiped.current = true;
      if (dir === 'next') onNext();
      else onPrev();
    },
    onPointerCancel: () => {
      start.current = null;
    },
    onClickCapture: (e) => {
      if (!swiped.current) return;
      swiped.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
    // The page still scrolls up and down under a finger; sideways is ours.
    style: { touchAction: 'pan-y' },
  };
}
