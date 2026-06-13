'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  text: string;
  className?: string;
}

/** Single-line text that scrolls horizontally to reveal its full content
 *  when it overflows its container, and stays static when it fits. Used for
 *  long song titles in the full-screen NowPlaying view. */
export function MarqueeText({ text, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0); // px of overflow (0 = fits, no scroll)

  useEffect(() => {
    const container = containerRef.current;
    const inner = innerRef.current;
    if (!container || !inner) return;
    const measure = () => {
      const overflow = inner.scrollWidth - container.clientWidth;
      setShift(overflow > 4 ? overflow : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  }, [text]);

  // Constant scroll speed (~40px/s) → longer titles take proportionally
  // longer, with a floor so short overflows don't whip past.
  const duration = shift > 0 ? Math.max(8, Math.round((shift / 40) * 2 + 4)) : 0;

  return (
    <div ref={containerRef} className={cn('overflow-hidden whitespace-nowrap', className)}>
      <span
        ref={innerRef}
        className={cn('inline-block', shift > 0 && 'ember-marquee-anim')}
        style={
          shift > 0
            ? {
                ['--marquee-shift' as string]: `-${shift}px`,
                animation: `ember-marquee ${duration}s ease-in-out infinite`,
              }
            : undefined
        }
      >
        {text}
      </span>
    </div>
  );
}
