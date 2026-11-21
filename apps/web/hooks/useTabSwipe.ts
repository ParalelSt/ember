'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useUiStore } from '@/stores/useUiStore';
import { hasOpenOverlay, markTabSwipe, isTabSwipeBlocked, tabSwipeTarget, type TabSwipeDir } from '@/lib/tabSwipe';

/** How long the new tab's slide-in may take before its class comes off
 *  regardless (an animation that never ends must not stay on <main>). */
const SLIDE_MS = 260;

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Phone only: a sideways swipe on `areaRef` (the app's scroller) on a tab page (Home, Search, Library) goes
 *  to the tab beside it, as the bottom bar orders them (lib/tabSwipe). The
 *  call is made when the finger lifts, so the page still scrolls up and
 *  down exactly as before; listeners are passive and never cancel a touch.
 *  The new page slides in a short way from the side it came from, unless
 *  the system asks for reduced motion. Desktop: nothing at all. */
export function useTabSwipe(areaRef: RefObject<HTMLElement | null>): void {
  const isDesktop = useIsDesktop();
  const router = useRouter();
  const pathname = usePathname();
  const pending = useRef<{ href: string; dir: TabSwipeDir } | null>(null);

  useEffect(() => {
    const area = areaRef.current;
    if (!area || isDesktop) return;
    let start: { x: number; y: number; blocked: boolean } | null = null;
    const onStart = (e: TouchEvent) => {
      // A second finger (a pinch) is never a swipe.
      if (e.touches.length !== 1) {
        start = null;
        return;
      }
      const t = e.touches[0];
      start = {
        x: t.clientX,
        y: t.clientY,
        blocked:
          isTabSwipeBlocked(e.target, area) || hasOpenOverlay(document) || useUiStore.getState().searchOpen,
      };
    };
    const onEnd = (e: TouchEvent) => {
      const s = start;
      start = null;
      const t = e.changedTouches[0];
      if (!s || !t || e.touches.length > 0) return;
      const target = tabSwipeTarget({
        dx: t.clientX - s.x,
        dy: t.clientY - s.y,
        pathname,
        search: window.location.search,
        blocked: s.blocked,
      });
      if (!target) return;
      pending.current = target;
      markTabSwipe();
      router.push(target.href);
    };
    const onCancel = () => {
      start = null;
    };
    area.addEventListener('touchstart', onStart, { passive: true });
    area.addEventListener('touchend', onEnd, { passive: true });
    area.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      area.removeEventListener('touchstart', onStart);
      area.removeEventListener('touchend', onEnd);
      area.removeEventListener('touchcancel', onCancel);
    };
  }, [areaRef, isDesktop, router, pathname]);

  // The swiped-to tab has arrived: slide it in from the side it came from.
  useEffect(() => {
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    if (pathname !== p.href || prefersReducedMotion()) return;
    const main = areaRef.current?.querySelector('main');
    if (!main) return;
    const cls = `ember-tab-in-${p.dir}`;
    main.classList.remove('ember-tab-in-next', 'ember-tab-in-prev');
    main.classList.add(cls);
    const done = () => main.classList.remove(cls);
    // Rows inside animate too (search results fading in): only main's own.
    const onEnd = (e: AnimationEvent) => {
      if (e.target === main) done();
    };
    main.addEventListener('animationend', onEnd);
    const timer = window.setTimeout(done, SLIDE_MS);
    return () => {
      window.clearTimeout(timer);
      main.removeEventListener('animationend', onEnd);
      done();
    };
  }, [pathname, areaRef]);
}
