'use client';

import type { CSSProperties } from 'react';
import { useUiStore } from '@/stores/useUiStore';
import { LyricsBody } from './LyricsBody';

/** Sticks just under the desktop top bar, which is sticky in the same
 *  scroller (components/nav/DesktopTopBar, `--ember-topbar-h`), and is that
 *  much shorter than the scroller. */
const STICK_UNDER_BAR: CSSProperties = {
  top: 'var(--ember-topbar-h, 0px)',
  height: 'calc(var(--ember-scroller-h, 100dvh) - var(--ember-topbar-h, 0px))',
};

/** Desktop (md:+) inline lyrics column. Sits to the right of <main> inside
 *  the outer scroller: `position: sticky` glues it under the top bar
 *  while main scrolls. That puts the scroller's scrollbar at the far right
 *  of the screen, past the panel, instead of squeezed between main and the
 *  panel. z-30 keeps it over the bar's cover; the bar lifts to z-40 while
 *  its search panel is open. Mobile uses the NowPlaying overlay's
 *  scroll-to-lyrics flow instead. */
export function LyricsPanel() {
  const open = useUiStore((s) => s.lyricsOpen);
  const setOpen = useUiStore((s) => s.setLyricsOpen);

  if (!open) return null;

  return (
    <aside
      className="hidden md:flex flex-col w-md max-w-[40vw] shrink-0 self-start sticky z-30 border-l border-sidebar-border bg-sidebar text-sidebar-foreground"
      style={STICK_UNDER_BAR}
      aria-label="Lyrics"
    >
      <LyricsBody active={open} onClose={() => setOpen(false)} />
    </aside>
  );
}
