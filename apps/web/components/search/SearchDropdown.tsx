'use client';

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { useTopBarPreview, type TopBarMode } from '@/components/nav/TopBarPreviewSwitch';
import { cn } from '@/lib/utils';

/** Popups that belong to the dropdown's own rows (a row's "…" menu, and any
 *  dialog it opens) render into a portal on <body>, so they are visually
 *  inside the dropdown but not inside its DOM. A press on one must not read
 *  as a press outside. */
const PORTALLED = [
  '[data-slot="dropdown-menu-content"]',
  '[data-slot="dialog-content"]',
  '[data-slot="dialog-overlay"]',
  '[data-sonner-toaster]',
].join(',');

/** The rows' own focus stops, in row order: arrow keys walk these. */
const ROW_STOP = '[data-testid="track-row-play"]';

/** As tall as a dropdown should get, and never taller than the space
 *  between the box and the player bar. `--ember-scroller-h` is the content
 *  column's scroller height, published by app/(app)/layout.tsx; the panel
 *  starts where that scroller starts, so subtracting one page gutter keeps
 *  its bottom edge clear of the player bar at every window size. The `vh`
 *  fallback only ever applies for the first frame, before the layout's
 *  ResizeObserver has measured. */
const PANEL_H_CLAMP = 'min(28rem, calc(var(--ember-scroller-h, 60vh) - 2rem))';

/* PREVIEW ONLY (TopBarPreviewSwitch): in modes 1 to 3 the bar sits INSIDE
 * the scroller, so `--ember-scroller-h` now includes it. The panel starts at
 * the pill's bottom, which is the bar's height (`--ember-topbar-h`) in mode
 * 1 and the bar's height less its 16px bottom padding in modes 2 and 3. */
const PANEL_H_CLAMP_IN_SCROLLER: Record<Exclude<TopBarMode, 4>, string> = {
  1: 'min(28rem, calc(var(--ember-scroller-h, 60vh) - var(--ember-topbar-h, 0px) - 2rem))',
  2: 'min(28rem, calc(var(--ember-scroller-h, 60vh) - var(--ember-topbar-h, 0px) + var(--spacing-block) - 2rem))',
  3: 'min(28rem, calc(var(--ember-scroller-h, 60vh) - var(--ember-topbar-h, 0px) + var(--spacing-block) - 2rem))',
};

/** The panel used to fill this same cap every time it held the Trending
 *  block (a heading plus a full results list), even with an empty query.
 *  Dropping Trending (bc7844b) left the panel free to shrink down to
 *  whatever a few recents take, which reads as broken chrome rather than a
 *  deliberate small box. Pinning min-height to the same clamp as the max
 *  brings that size back: the panel is always exactly as tall as the room
 *  allows, 1 recent or 10, and still yields to a short window because both
 *  bounds are driven by the same `--ember-scroller-h` term. */
function panelMaxH(mode: TopBarMode): CSSProperties {
  const clamp = mode === 4 ? PANEL_H_CLAMP : PANEL_H_CLAMP_IN_SCROLLER[mode];
  return { minHeight: clamp, maxHeight: clamp };
}

/* PREVIEW ONLY: the bar's own box per mode (components/library/options/
 * topbar has the /dizajn mocks and the owner's brief). Every cover hangs
 * off the box (absolute), so none of them takes layout space. Modes 1 to 3
 * are `sticky top-0` inside the scroller; z-20 keeps them over the page,
 * z-40 while the panel is open so it also clears the lyrics panel (z-30). */
const BAR_BOX: Record<TopBarMode, string> = {
  1: 'sticky top-0 px-page-lg pt-page-lg',
  2: 'sticky top-0 px-page-lg pt-page-lg pb-block bg-background/80 backdrop-blur-xl',
  3: 'sticky top-0 px-page-lg py-block bg-sidebar',
  4: 'px-page-lg pt-page-lg',
};

export interface SearchDropdownProps {
  open: boolean;
  onClose: () => void;
  /** The search input row. A real box in the page, at the top of the
   *  content column, always there: this is the thing the panel hangs off
   *  and the thing "/" focuses. */
  field: ReactNode;
  /** Recents + results. Scrolls inside the panel when there are many. */
  body: ReactNode;
}

/** The desktop shape of search: a real search box at the top of the content
 *  column with the results hanging under it. NOT a dialog.
 *
 *  Deliberately not `components/ui/dialog`, and deliberately not the
 *  base-ui primitives next to it either:
 *
 *  - `dialog` renders a backdrop and an `aria-modal` popup with a focus
 *    trap, which is exactly the thing being removed: it put the player bar,
 *    the sidebar and the page out of reach while search was open.
 *  - `dropdown-menu` is a base-ui Menu: `role="menu"` with roving focus and
 *    typeahead, which fights a text input and rows full of buttons.
 *  - a base-ui Popover would portal the panel to <body> and drive it from a
 *    Trigger element, while this panel's open flag lives in the UI store and
 *    is set from three places (the sidebar link, the phone nav, "/"). Its
 *    floating positioner would also be doing work we do not need: the box is
 *    in the page, right above the panel, so `absolute top-full` is both the
 *    simplest and the most predictable answer.
 *
 *  So: an ordinary block in the page with one absolutely positioned panel
 *  under it. No backdrop, no `aria-modal`, no focus trap, nothing else on
 *  screen covered, dimmed or pulled out of the accessibility tree. */
export function SearchDropdown({ open, onClose, field, body }: SearchDropdownProps) {
  // Box AND panel: a press anywhere in here is a press inside.
  const anchorRef = useRef<HTMLDivElement>(null);
  // Where focus was when the panel opened, so Escape can hand it back.
  // One element to restore, not a trap to unwind.
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // Opening from the sidebar link or "/" puts the caret in the box; opening
  // by focusing or typing in the box already has it there, so this is a
  // no-op on that path.
  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    anchorRef.current?.querySelector('input')?.focus();
    return () => {
      returnFocusRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (!target || typeof target.closest !== 'function' || !target.isConnected) return;
      if (anchorRef.current?.contains(target)) return;
      if (target.closest(PORTALLED)) return;
      onClose();
    };

    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const back = returnFocusRef.current;
      const active = document.activeElement as HTMLElement | null;
      onClose();
      if (back?.isConnected && back !== document.body) {
        // `back` is outside the panel, so React unmounting the panel cannot
        // steal this focus back to <body>.
        back.focus();
      } else if (active && anchorRef.current?.contains(active)) {
        // Opened by "/" from the page: leave the box, or the guard in
        // useSearchShortcut would swallow the next "/" as typing.
        active.blur();
      }
    };

    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  /** Up/down walk the rows' play controls; up from the first row goes back
   *  to the box. Tab still reaches every control on a row, this is only the
   *  quick way down the list. */
  const onArrowKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const anchor = anchorRef.current;
    if (!anchor || !open) return;
    const stops = [...anchor.querySelectorAll<HTMLElement>(ROW_STOP)];
    if (stops.length === 0) return;

    const here = stops.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      stops[here < 0 ? 0 : Math.min(here + 1, stops.length - 1)].focus();
      return;
    }
    if (here < 0) return;
    e.preventDefault();
    if (here === 0) anchor.querySelector('input')?.focus();
    else stops[here - 1].focus();
  };

  // PREVIEW ONLY: which top bar, and whether the page under it is scrolled
  // (modes 1 and 2 only show their covers / divider once it is).
  const mode = useTopBarPreview((s) => s.mode);
  const setBarH = useTopBarPreview((s) => s.setBarH);
  const inScroller = mode !== 4;
  const barRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const bar = barRef.current;
    const scroller = bar?.closest<HTMLElement>('[data-app-scroller]');
    if (!bar || !scroller || !inScroller) {
      setScrolled(false);
      return;
    }
    const onScroll = () => setScrolled(scroller.scrollTop > 0);
    onScroll();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    const ro = new ResizeObserver(() => setBarH(bar.offsetHeight));
    ro.observe(bar);
    setBarH(bar.offsetHeight);
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      ro.disconnect();
      setBarH(0);
    };
  }, [inScroller, setBarH]);

  return (
    <div
      ref={barRef}
      data-testid="topbar-bar"
      data-topbar-mode={mode}
      data-scrolled={scrolled || undefined}
      className={cn('shrink-0', BAR_BOX[mode], inScroller && (open ? 'z-40' : 'z-20'))}
    >
      {/* PREVIEW ONLY covers. Mode 1: page background behind the pill row
          and a 16px band under it, then a 24px fade, once scrolled. Modes
          2 and 3: the band is the bar's own bottom padding; a hairline
          (absolute, so it adds no height) marks its edge, always in 3 and
          once scrolled in 2. */}
      {mode === 1 && scrolled && (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="h-full bg-background" />
          <div data-testid="topbar-band" className="h-block bg-background" />
          <div className="h-stack bg-linear-to-b from-background to-transparent" />
        </div>
      )}
      {(mode === 3 || (mode === 2 && scrolled)) && (
        <div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 h-px',
            mode === 3 ? 'bg-sidebar-border' : 'bg-border',
          )}
        />
      )}
      {/* Lines the box up with the page's own content column. */}
      <div className="mx-auto max-w-(--content-max)">
        <div
          ref={anchorRef}
          onKeyDown={onArrowKeys}
          role="search"
          aria-label="Search"
          className="relative max-w-xl"
        >
          {field}
          {open && (
            <div
              data-testid="search-dropdown"
              style={panelMaxH(mode)}
              className="absolute inset-x-0 top-full z-30 mt-cluster flex flex-col overflow-y-auto rounded-xl bg-popover p-block text-sm text-popover-foreground shadow-soft ring-1 ring-foreground/10"
            >
              {body}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
