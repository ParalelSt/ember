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
      const avail = container.clientWidth;
      if (!w || !avail) return; // not laid out yet — wait for a later trigger
      setTextWidth(w);
      setOverflowing(w > avail + 4);
    };

    run();
    // Re-measure once a frame later (layout settled) and after web fonts load
    // — the title font changes text width and the first pass can run too early.
    const raf = requestAnimationFrame(run);
    let cancelled = false;
    if (typeof document !== 'undefined' && 'fonts' in document) {
      document.fonts.ready.then(() => { if (!cancelled) run(); }).catch(() => {});
    }
    const ro = new ResizeObserver(run);
    ro.observe(container);
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [text]);

  const shift = textWidth + GAP_PX;
  const duration = Math.max(6, Math.round(shift / SPEED));

  return (
    <div ref={containerRef} className={cn('overflow-hidden whitespace-nowrap', className)}>
      {/* The track is always rendered with the same first span (stable ref so
          re-measures stay accurate). It only becomes an animated two-copy
          marquee when the title overflows; otherwise it's a static line. */}
      <div
        className={overflowing ? 'ember-marquee-anim flex w-max' : 'inline-block'}
        style={
          overflowing
            ? {
                ['--marquee-shift' as string]: `-${shift}px`,
                animation: `ember-marquee-loop ${duration}s linear ${START_DELAY_MS}ms infinite`,
              }
            : undefined
        }
      >
        <span
          ref={measureRef}
          className="inline-block"
          style={overflowing ? { marginRight: GAP_PX } : undefined}
        >
          {text}
        </span>
        {overflowing && (
          <span className="inline-block" aria-hidden="true">
            {text}
          </span>
        )}
      </div>
    </div>
  );
}
