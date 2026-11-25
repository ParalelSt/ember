'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from 'react';
import { SWIPE_MIN_PX } from '@/hooks/player/useSwipeSkip';

/** A drag shorter than this sideways (or up and down) is still a tap. */
const LOCK_PX = 8;
/** How long the old song takes to slide out, and the new one to slide in. */
const OUT_MS = 130;
const IN_MS = 170;
/** Width used when the element cannot be measured. */
const FALLBACK_W = 360;

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export interface SwipeSlideProps {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
  onClickCapture: (e: MouseEvent<HTMLElement>) => void;
  style: CSSProperties;
}

/** Swipe the phone player bar: the bar follows the finger, and past the
 *  threshold it slides out, the skip happens, and the new song slides in from
 *  the other side (left swipe: next, right swipe: previous). Short of the
 *  threshold it springs back. The direction is decided once, a few pixels
 *  into the drag: a sideways start is ours for the whole drag however much
 *  the thumb drifts up or down after, an up-and-down start never is, and a
 *  tap (no real movement) is left alone for its click. Under
 *  prefers-reduced-motion nothing moves; a long enough swipe just skips. */
export function useSwipeSlide({ onNext, onPrev }: { onNext: () => void; onPrev: () => void }): SwipeSlideProps {
  const start = useRef<{ x: number; y: number; id: number; w: number; axis: 'x' | 'y' | null } | null>(null);
  const swiped = useRef(false);
  const leaving = useRef(false);
  const timers = useRef<number[]>([]);
  const cbs = useRef({ onNext, onPrev });
  cbs.current = { onNext, onPrev };
  const [offset, setOffset] = useState(0);
  const [animate, setAnimate] = useState(false);
  const [width, setWidth] = useState(FALLBACK_W);

  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
    },
    [],
  );

  const later = useCallback((fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  }, []);

  const springBack = () => {
    setAnimate(true);
    setOffset(0);
  };

  const commit = (dir: 'next' | 'prev', w: number) => {
    const call = () => (dir === 'next' ? cbs.current.onNext() : cbs.current.onPrev());
    if (prefersReducedMotion()) {
      call();
      return;
    }
    leaving.current = true;
    setAnimate(true);
    setOffset(dir === 'next' ? -w : w);
    later(() => {
      call();
      // The new song waits just off the far side, then slides in.
      setAnimate(false);
      setOffset(dir === 'next' ? w : -w);
      later(() => {
        leaving.current = false;
        setAnimate(true);
        setOffset(0);
      }, 30);
    }, OUT_MS);
  };

  const end = (e: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const s = start.current;
    start.current = null;
    if (!s || s.id !== e.pointerId) return;
    if (s.axis !== 'x') return;
    const dx = e.clientX - s.x;
    if (!cancelled && Math.abs(dx) >= SWIPE_MIN_PX) {
      swiped.current = true;
      commit(dx < 0 ? 'next' : 'prev', s.w);
    } else {
      // A cancelled or short drag: the click that may follow is not ours.
      swiped.current = Math.abs(dx) >= LOCK_PX;
      springBack();
    }
  };

  const reduced = prefersReducedMotion();
  const dragging = offset !== 0 && !animate;
  const fade = Math.min(Math.abs(offset) / width, 1) * 0.6;

  return {
    onPointerDown: (e) => {
      if (leaving.current) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const w = e.currentTarget.getBoundingClientRect?.().width || FALLBACK_W;
      setWidth(w);
      start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, w, axis: null };
      swiped.current = false;
      setAnimate(false);
    },
    onPointerMove: (e) => {
      const s = start.current;
      if (!s || s.id !== e.pointerId) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (!s.axis) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < LOCK_PX) return;
        s.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        // Keep the drag even when the thumb leaves the bar.
        if (s.axis === 'x') {
          try {
            e.currentTarget.setPointerCapture?.(e.pointerId);
          } catch {
            // A pointer the browser already let go of: nothing to keep.
          }
        }
      }
      if (s.axis !== 'x' || reduced) return;
      setOffset(Math.max(-s.w, Math.min(s.w, dx)));
    },
    onPointerUp: (e) => end(e, false),
    onPointerCancel: (e) => end(e, true),
    onClickCapture: (e) => {
      if (!swiped.current) return;
      swiped.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
    // The bar has nothing to scroll: the browser must never claim a drag on
    // it (a slightly slanted swipe used to be cancelled as a page pan).
    style: {
      touchAction: 'none',
      transform: offset ? `translateX(${offset}px)` : undefined,
      opacity: offset ? 1 - fade : undefined,
      transition: dragging || !animate ? 'none' : `transform ${animate && leaving.current ? OUT_MS : IN_MS}ms ease-out, opacity ${IN_MS}ms ease-out`,
    },
  };
}
