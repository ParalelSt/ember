'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** How long the user must leave the lyrics alone before following can turn
 *  itself back on. */
export const RELOCK_IDLE_MS = 3000;

/** The centered share of the scroller's height that counts as "the middle":
 *  the current line has to be in here for an automatic re-lock. */
const MIDDLE_BAND = 0.6;

/** Keys that scroll a focused scroller (or a focused line inside it). */
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' ', 'Spacebar']);

export type FollowDirection = 'up' | 'down';

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** 'smooth' when asked for and the user allows motion, otherwise 'auto'. */
export function scrollBehavior(smooth: boolean): ScrollBehavior {
  return smooth && !prefersReducedMotion() ? 'smooth' : 'auto';
}

/** Scrolls ONLY `container` so `el` sits at its vertical center.
 *  scrollIntoView walks the ancestor chain and would yank the main app
 *  shell (search, home) along with the lyrics. */
export function centerLine(container: HTMLElement, el: HTMLElement, behavior: ScrollBehavior) {
  const containerRect = container.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();
  const scrollDelta = elRect.top - containerRect.top - container.clientHeight / 2 + el.clientHeight / 2;
  container.scrollTo({ top: container.scrollTop + scrollDelta, behavior });
}

/** The line's vertical center, measured from the top of the scroller's view. */
function lineCenter(container: HTMLElement, el: HTMLElement): { center: number; height: number } {
  const c = container.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { center: r.top + r.height / 2 - c.top, height: c.height };
}

function inMiddleBand(container: HTMLElement, el: HTMLElement): boolean {
  const { center, height } = lineCenter(container, el);
  if (height <= 0) return false;
  const margin = (height * (1 - MIDDLE_BAND)) / 2;
  return center >= margin && center <= height - margin;
}

function directionTo(container: HTMLElement, el: HTMLElement | null): FollowDirection {
  // Before the first line the "current spot" is the top of the list.
  if (!el) return 'up';
  const { center, height } = lineCenter(container, el);
  return center < height / 2 ? 'up' : 'down';
}

interface Options {
  /** The overflow container holding the lyric lines. */
  scrollerRef: RefObject<HTMLElement | null>;
  /** Line elements by index. */
  lineRefs: RefObject<Array<HTMLElement | null>>;
  /** The current line, -1 before the first one. */
  activeIdx: number;
  /** Changes when the song changes; following turns back on. */
  resetKey: unknown;
}

/** "Smart" follow mode for synced lyrics. Following (auto-scrolling the
 *  current line to the center) is on by default. A user scroll turns it
 *  off; programmatic scrolls never do, because intent is read from the
 *  input events (wheel, touch, pointer on the scrollbar, scroll keys), not
 *  from `scroll`. It turns back on by itself once the user has been idle
 *  for RELOCK_IDLE_MS AND the current line is in the middle of the view,
 *  never while a finger or pointer is down. Callers re-lock explicitly on
 *  a line tap or a big seek (`relock`) and on the pill (`resume`). */
export function useLyricsFollow({ scrollerRef, lineRefs, activeIdx, resetKey }: Options) {
  // Following is stored per song: a new resetKey reads as following until
  // the user scrolls again, with no state update needed on song change.
  const [lock, setLock] = useState<{ following: boolean; key: unknown }>({ following: true, key: resetKey });
  const following = lock.key === resetKey ? lock.following : true;
  const keyRef = useRef(resetKey);
  const [direction, setDirection] = useState<FollowDirection>('down');
  const followingRef = useRef(true);
  const activeIdxRef = useRef(activeIdx);
  const lastInputRef = useRef(0);
  const holdingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeLine = useCallback(
    () => (activeIdxRef.current >= 0 ? (lineRefs.current?.[activeIdxRef.current] ?? null) : null),
    [lineRefs],
  );

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const relock = useCallback(() => {
    clearTimer();
    followingRef.current = true;
    setLock({ following: true, key: keyRef.current });
  }, []);

  const tryRelock = useCallback(() => {
    if (followingRef.current || holdingRef.current) return;
    if (Date.now() - lastInputRef.current < RELOCK_IDLE_MS) return;
    const container = scrollerRef.current;
    const el = activeLine();
    if (container && el && inMiddleBand(container, el)) relock();
  }, [scrollerRef, activeLine, relock]);

  const updateDirection = useCallback(() => {
    const container = scrollerRef.current;
    if (container) setDirection(directionTo(container, activeLine()));
  }, [scrollerRef, activeLine]);

  /** Back to the current line: follow again and center it. */
  const resume = useCallback(() => {
    relock();
    const container = scrollerRef.current;
    if (!container) return;
    const el = activeLine();
    if (!el || activeIdxRef.current === 0) container.scrollTo({ top: 0, behavior: scrollBehavior(true) });
    else centerLine(container, el, scrollBehavior(true));
  }, [relock, scrollerRef, activeLine]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;

    const markInput = () => {
      lastInputRef.current = Date.now();
      clearTimer();
      timerRef.current = setTimeout(tryRelock, RELOCK_IDLE_MS);
    };
    const stopFollowing = () => {
      // Lyrics that fit without scrolling have nothing to scroll away from.
      if (el.scrollHeight <= el.clientHeight) return;
      if (followingRef.current) {
        followingRef.current = false;
        setLock({ following: false, key: keyRef.current });
      }
      updateDirection();
      markInput();
    };

    const onWheel = () => stopFollowing();
    const onTouchStart = () => {
      holdingRef.current = true;
      markInput();
    };
    const onTouchMove = () => stopFollowing();
    const onRelease = () => {
      if (!holdingRef.current) return;
      holdingRef.current = false;
      markInput();
    };
    const onPointerDown = (e: PointerEvent) => {
      // Touch is handled by the touch events (a tap on a line is not a
      // scroll). A mouse press on the scroller itself, not on a line, is a
      // grab of its scrollbar.
      if (e.pointerType === 'touch' || e.target !== el) return;
      holdingRef.current = true;
      stopFollowing();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (SCROLL_KEYS.has(e.key)) stopFollowing();
    };
    const onScroll = () => {
      // Our own scrolls only happen while following, so any scroll while
      // unlocked is the user's (a scrollbar drag, momentum after a flick).
      if (followingRef.current) return;
      updateDirection();
      markInput();
    };

    el.addEventListener('wheel', onWheel, { passive: true });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: true });
    el.addEventListener('touchend', onRelease);
    el.addEventListener('touchcancel', onRelease);
    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onRelease);
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onRelease);
      el.removeEventListener('touchcancel', onRelease);
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onRelease);
      el.removeEventListener('keydown', onKeyDown);
      el.removeEventListener('scroll', onScroll);
      clearTimer();
    };
  }, [scrollerRef, tryRelock, updateDirection]);

  // A new song always starts out following. Declared before the line-change
  // effect so that one already sees the reset when both fire together.
  useEffect(() => {
    keyRef.current = resetKey;
    followingRef.current = true;
    clearTimer();
  }, [resetKey]);

  // Each line change: the song may have carried the current line into the
  // middle of where the user is reading, and the pill's arrow may flip.
  useEffect(() => {
    activeIdxRef.current = activeIdx;
    if (followingRef.current) return;
    tryRelock();
    if (!followingRef.current) updateDirection();
  }, [activeIdx, tryRelock, updateDirection]);

  return { following, followingRef, direction, relock, resume, behavior: scrollBehavior };
}
