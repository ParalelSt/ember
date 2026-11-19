'use client';

import { useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';

/** How far a finger must travel sideways for a swipe to skip. */
export const SWIPE_MIN_PX = 48;

/** What a drag of (dx, dy) px does: left is the next song, right the one
 *  before, like turning a page. Mostly sideways only (a scroll that drifts
 *  is not a skip). */
export function swipeDirection(dx: number, dy: number): 'next' | 'prev' | null {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? 'next' : 'prev';
}

/** A follow drag starts after this much sideways travel, and stops here. */
const FOLLOW_START_PX = 8;
const FOLLOW_MAX_PX = 96;

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export interface SwipeSkipProps {
  onPointerDown?: (e: PointerEvent) => void;
  onPointerMove?: (e: PointerEvent) => void;
  onPointerUp?: (e: PointerEvent) => void;
  onPointerCancel?: () => void;
  onClickCapture?: (e: MouseEvent) => void;
  style?: CSSProperties;
}

/** Swipe the cover to skip (the head unit's car controls): spread the
 *  returned props on the element. Nothing when `enabled` is false. A swipe
 *  that ends on a link inside does not also open it. */
export function useSwipeSkip({
  onNext,
  onPrev,
  enabled,
  follow = false,
}: {
  onNext: () => void;
  onPrev: () => void;
  enabled: boolean;
  /** The element follows the finger sideways while it drags and springs
   *  back on release (not under prefers-reduced-motion). */
  follow?: boolean;
}): SwipeSkipProps {
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const swiped = useRef(false);
  const [dragX, setDragX] = useState(0);
  const [dragging, setDragging] = useState(false);
  if (!enabled) return {};
  const canFollow = follow && !prefersReducedMotion();
  const endDrag = () => {
    setDragging(false);
    setDragX(0);
  };
  return {
    onPointerDown: (e) => {
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      swiped.current = false;
    },
    onPointerMove: canFollow
      ? (e) => {
          const s = start.current;
          if (!s || s.id !== e.pointerId) return;
          const dx = e.clientX - s.x;
          const dy = e.clientY - s.y;
          // Only a mostly sideways move drags the element; a scroll does not.
          if (Math.abs(dx) < FOLLOW_START_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          setDragging(true);
          setDragX(Math.max(-FOLLOW_MAX_PX, Math.min(FOLLOW_MAX_PX, dx)));
        }
      : undefined,
    onPointerUp: (e) => {
      const s = start.current;
      start.current = null;
      if (canFollow) endDrag();
      if (!s || s.id !== e.pointerId) return;
      const dir = swipeDirection(e.clientX - s.x, e.clientY - s.y);
      if (!dir) return;
      swiped.current = true;
      if (dir === 'next') onNext();
      else onPrev();
    },
    onPointerCancel: () => {
      start.current = null;
      if (canFollow) endDrag();
    },
    onClickCapture: (e) => {
      if (!swiped.current) return;
      swiped.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
    // The page still scrolls up and down under a finger; sideways is ours.
    style: canFollow
      ? {
          touchAction: 'pan-y',
          transform: dragX ? `translateX(${dragX}px)` : undefined,
          transition: dragging ? 'none' : 'transform 180ms ease-out',
        }
      : { touchAction: 'pan-y' },
  };
}
