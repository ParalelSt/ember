'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const FADE_PX = 32;

/** A vertical scroller that fades out at an edge only while there is more
 *  past it: the top edge once scrolled down, the bottom while content is
 *  left below. A list that fits shows no fade. `min-h-0` lets it shrink to
 *  the space the parent flex column gives it instead of growing past it. */
export function FadeScroll({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ top: false, bottom: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const top = el.scrollTop > 1;
    const bottom = el.scrollTop + el.clientHeight < el.scrollHeight - 1;
    setEdge((e) => (e.top === top && e.bottom === bottom ? e : { top, bottom }));
  }, []);

  // The list changing (a playlist added, a reorder) moves the edges without a scroll.
  useEffect(() => {
    measure();
  });
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  const mask = `linear-gradient(to bottom, ${edge.top ? 'transparent' : '#000'} 0px, #000 ${FADE_PX}px, #000 calc(100% - ${FADE_PX}px), ${edge.bottom ? 'transparent' : '#000'} 100%)`;
  return (
    <div
      ref={ref}
      data-testid="playlist-scroller"
      data-fade-top={edge.top}
      data-fade-bottom={edge.bottom}
      onScroll={measure}
      className={cn('min-h-0 flex-1 overflow-y-auto', className)}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    >
      {children}
    </div>
  );
}
