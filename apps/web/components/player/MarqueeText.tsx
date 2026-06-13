'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  text: string;
  className?: string;
}

// Empty space between the end of the title and where it loops back in — the
// "little break" between repeats.
const GAP_PX = 56;
// Scroll speed in px/s; duration is derived so speed is constant regardless
// of title length.
const SPEED = 45;
// Small pause before the scroll begins (first iteration only).
const START_DELAY_MS = 200;

/** Single-line text that, when it overflows its container, scrolls
 *  continuously in one direction and loops seamlessly (the title slides off
 *  the left, a gap passes, then it re-enters from the right). Titles that fit
 *  stay static. Used for long song titles in the full-screen NowPlaying view. */
export function MarqueeText({ text, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [textWidth, setTextWidth] = useState(0);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;
    const run = () => {
      const w = measure.scrollWidth;
      setTextWidth(w);
      setOverflowing(w > container.clientWidth + 4);
    };
    run();
    const ro = new ResizeObserver(run);
    ro.observe(container);
    return () => ro.disconnect();
  }, [text]);

  // Fits → render a single static copy.
  if (!overflowing) {
    return (
      <div ref={containerRef} className={cn('overflow-hidden whitespace-nowrap', className)}>
        <span ref={measureRef} className="inline-block">{text}</span>
      </div>
    );
  }

  // Overflows → two copies + gap, translate by (textWidth + gap) so copy 2
  // lands exactly where copy 1 began for a seamless loop.
  const shift = textWidth + GAP_PX;
  const duration = Math.max(6, Math.round(shift / SPEED));

  return (
    <div ref={containerRef} className={cn('overflow-hidden whitespace-nowrap', className)}>
      <div
        className="ember-marquee-anim flex w-max"
        style={{
          ['--marquee-shift' as string]: `-${shift}px`,
          animation: `ember-marquee-loop ${duration}s linear ${START_DELAY_MS}ms infinite`,
        }}
      >
        {/* Gap is a margin (excluded from scrollWidth) so the measured text
            width stays accurate and the shift isn't double-counted. */}
        <span ref={measureRef} className="inline-block" style={{ marginRight: GAP_PX }}>
          {text}
        </span>
        <span className="inline-block" aria-hidden="true">
          {text}
        </span>
      </div>
    </div>
  );
}
