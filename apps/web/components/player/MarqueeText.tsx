'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  text: string;
  className?: string;
  /** Only animate while the view is actually on-screen. NowPlaying stays
   *  mounted (translated off-screen) when closed, so without this the CSS
   *  animation runs — and burns through its start delay — while hidden, and
   *  you'd open the view to find it already mid-scroll. Gating on `active`
   *  makes the animation (and its delay) start when the view opens. */
  active?: boolean;
}

// Empty space between the end of the title and where it loops back in — the
// "little break" between repeats.
const GAP_PX = 56;
// Scroll speed in px/s; duration is derived so speed is constant regardless
// of title length.
const SPEED = 45;
// Pause before the scroll begins (first iteration only).
const START_DELAY_MS = 1000;
// Hysteresis around the overflow threshold. A title has to overrun the box
// by START_PX before it starts scrolling, and has to come STOP_PX clear of
// the edge before it goes static again. Without the gap between the two, a
// title sitting within a pixel of the edge flips state on every measure and
// the whole thing strobes.
const START_PX = 4;
const STOP_PX = 12;

/** Whether the title should be scrolling, given the last answer. Sticky
 *  inside [avail - STOP_PX, avail + START_PX]: measurements that land in
 *  that band leave the state alone, so alternating measurements settle
 *  instead of oscillating. Exported for the unit tests. */
export function shouldScroll(prev: boolean, textWidth: number, available: number): boolean {
  // Nothing laid out yet (a hidden view, a first pass before layout):
  // nothing has been measured, so keep the answer we already had.
  if (textWidth <= 0 || available <= 0) return prev;
  return prev ? textWidth > available - STOP_PX : textWidth > available + START_PX;
}

/** Single-line text that, when it overflows its container, scrolls
 *  continuously in one direction and loops seamlessly (the title slides off
 *  the left, a gap passes, then it re-enters from the right). Titles that fit
 *  stay static. Used for long song titles in the full-screen NowPlaying view. */
export function MarqueeText({ text, className, active = true }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [textWidth, setTextWidth] = useState(0);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;

    const run = () => {
      // The ruler is absolutely positioned at max-content width and never
      // changes with the animation, so measuring it cannot change the box
      // the ResizeObserver below is watching: no measure/render loop.
      const w = Math.ceil(measure.getBoundingClientRect().width);
      const avail = container.clientWidth;
      if (!w || !avail) return; // not laid out yet — wait for a later trigger
      setTextWidth(w);
      setOverflowing((prev) => shouldScroll(prev, w, avail));
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
  // Animate only when overflowing AND on-screen. Toggling this when the view
  // opens applies the animation fresh, so the start delay counts from open.
  const animate = overflowing && active;

  return (
    <div
      ref={containerRef}
      data-testid="marquee"
      className={cn('relative overflow-hidden whitespace-nowrap', className)}
    >
      {/* The ruler: one copy of the title at its natural width, out of flow
          and invisible, in the container's own font. It is the only thing
          ever measured, so what the marquee does next can never change what
          the next measurement says. */}
      <span
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute left-0 top-0 w-max"
      >
        {text}
      </span>
      {/* The track. One copy, sitting still, until the title overflows AND
          the view is open; then a second copy follows it across. shrink-0
          keeps both copies at their natural width: they are flex items, so
          without it a narrow track would squeeze them and the two copies
          would paint over each other. */}
      <div
        data-testid="marquee-track"
        className={animate ? 'ember-marquee-anim flex w-max' : 'block w-max'}
        style={
          animate
            ? {
                ['--marquee-shift' as string]: `-${shift}px`,
                animation: `ember-marquee-loop ${duration}s linear ${START_DELAY_MS}ms infinite`,
              }
            : undefined
        }
      >
        <span className="shrink-0" style={animate ? { marginRight: GAP_PX } : undefined}>
          {text}
        </span>
        {animate && (
          <span className="shrink-0" aria-hidden="true">
            {text}
          </span>
        )}
      </div>
    </div>
  );
}
