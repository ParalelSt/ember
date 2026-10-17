'use client';

import { useState, useEffect, useCallback, type RefObject } from 'react';
import { ChevronUpIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

interface Props {
  /** Ref to the scrollable container, the `<main>` element in (app)/layout. */
  scrollRef: RefObject<HTMLElement | null>;
}

const SHOW_AFTER_PX = 400;

/** Floating "Back to top" pill that appears after the user has scrolled
 *  the main area past SHOW_AFTER_PX. Useful after expanding a song box
 *  that grew the page well below the fold.
 *
 *  Placed against the bottom of the scroller's column (app/(app)/layout.tsx
 *  gives it a `relative` parent), not the window, so it sits the same step
 *  above the scroller's edge with or without the player bar, and needs no
 *  safe-area term: the bars below the column carry that (bughunt V12). The
 *  page ends with `pb-section` of room, more than this lift plus the
 *  button, so at the end of any page the last controls clear it. */
export function BackToTop({ scrollRef }: Props) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const handler = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setVisible(el.scrollTop > SHOW_AFTER_PX));
    };
    handler();
    el.addEventListener('scroll', handler, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('scroll', handler);
    };
  }, [scrollRef]);

  const onClick = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [scrollRef]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Back to top"
      title="Back to top"
      // globals.css lifts it over the Copy to… bar while that is showing.
      data-back-to-top
      className={cn(
        'absolute right-block z-40 md:right-(--back-to-top-right) size-10 rounded-full bg-ember hover:bg-ember-soft text-ember-foreground shadow-glow',
        'flex items-center justify-center',
        'transition-all duration-200',
        // Phone: 16px from the right, 24px above the player (owner pick
        // backtop1). Desktop: centered in the empty space right of the
        // page content (owner, 2026-10-17), see --back-to-top-right in globals.css.
        'bottom-stack md:bottom-block',
        visible
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 translate-y-2 pointer-events-none',
      )}
    >
      <ChevronUpIcon className="size-6 -translate-y-px" />
    </button>
  );
}
