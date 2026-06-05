'use client';

import { useState, useEffect, useCallback, type RefObject } from 'react';
import { ChevronUpIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

interface Props {
  /** Ref to the scrollable container — the `<main>` element in (app)/layout. */
  scrollRef: RefObject<HTMLElement | null>;
}

const SHOW_AFTER_PX = 400;

/** Floating "Back to top" pill that appears after the user has scrolled
 *  the main area past SHOW_AFTER_PX. Useful after expanding a song box
 *  that grew the page well below the fold. */
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
      className={cn(
        'fixed right-6 z-40 size-10 rounded-full bg-ember hover:bg-ember-soft text-white shadow-glow',
        'flex items-center justify-center',
        'transition-all duration-200',
        'bottom-36 md:bottom-28',
        visible
          ? 'opacity-100 translate-y-0 pointer-events-auto'
          : 'opacity-0 translate-y-2 pointer-events-none',
      )}
    >
      <ChevronUpIcon className="size-6 -translate-y-px" strokeWidth={3} />
    </button>
  );
}
