'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface Props {
  /** The search panel is open: lift the bar (and the panel hanging off it)
   *  over the lyrics panel, which sits at z-30 in the same scroller. */
  raised: boolean;
  /** The bar's own height in px, 0 when it unmounts or holds nothing (the
   *  /search page draws its own box). The layout publishes it as
   *  `--ember-topbar-h` for the lyrics panel, the search panel's height cap,
   *  the tabs toolbar and the Appearance preview. Must be stable. */
  onHeightChange: (h: number) => void;
  /** The search box (SearchOverlayContainer). */
  children: ReactNode;
}

/** The desktop top bar, the "floating pill": the search box sits `sticky
 *  top-0` INSIDE the page scroller (`[data-app-scroller]`), so the
 *  scrollbar runs the full height of the content column and the page
 *  slides away under the pill.
 *
 *  At scroll top nothing is drawn but the pill: the page sits under the bar
 *  in flow, so its heading is exactly where it was when the bar stood above
 *  the scroller. Once the page scrolls, a cover in the page background
 *  fills the bar's box and a 16px band under the pill, then a 24px fade.
 *  The cover is absolute, so it takes no layout space, and uses theme
 *  tokens only, so it holds under every theme. Phones never render this:
 *  they keep the TopBar and the full-screen search sheet. */
export function DesktopTopBar({ raised, onHeightChange, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const bar = ref.current;
    if (!bar) return;
    const scroller = bar.closest<HTMLElement>('[data-app-scroller]');
    const onScroll = () => setScrolled((scroller?.scrollTop ?? 0) > 0);
    onScroll();
    scroller?.addEventListener('scroll', onScroll, { passive: true });
    const measure = () => {
      const h = bar.offsetHeight;
      setHeight(h);
      onHeightChange(h);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    return () => {
      scroller?.removeEventListener('scroll', onScroll);
      ro.disconnect();
      onHeightChange(0);
    };
  }, [onHeightChange]);

  return (
    <div
      ref={ref}
      data-testid="topbar-bar"
      data-scrolled={scrolled || undefined}
      className={cn('sticky top-0', raised ? 'z-40' : 'z-20')}
    >
      {scrolled && height > 0 && (
        <div aria-hidden data-testid="topbar-cover" className="pointer-events-none absolute inset-0">
          <div className="h-full bg-background" />
          <div data-testid="topbar-band" className="h-block bg-background" />
          <div className="h-stack bg-linear-to-b from-background to-transparent" />
        </div>
      )}
      {/* relative: the pill paints over the cover. */}
      <div className="relative">{children}</div>
    </div>
  );
}
