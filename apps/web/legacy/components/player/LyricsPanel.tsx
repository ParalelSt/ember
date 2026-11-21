'use client';

import type { CSSProperties } from 'react';
import { useUiStore } from '@/stores/useUiStore';
import { LyricsBody } from './LyricsBody';

/** The panel's width (was `w-md max-w-[40vw]`). The app layout reads it
 *  too, so the top bar stops short of the panel. */
export const LYRICS_PANEL_W = 'min(28rem, 40vw)';

/** Spans the whole scroller, from the top of the window to the player bar.
 *  The panel sits in the row under the desktop top bar
 *  (components/nav/DesktopTopBar, `--ember-topbar-h` tall), so it is pulled
 *  up by that much and sticks at the scroller's top; the bar stops short of
 *  the panel (`--ember-lyrics-w`), so nothing is drawn above it. */
const FULL_HEIGHT: CSSProperties = {
  width: LYRICS_PANEL_W,
  top: 0,
  marginTop: 'calc(-1 * var(--ember-topbar-h, 0px))',
  height: 'var(--ember-scroller-h, 100dvh)',
};

/** Desktop (md:+) inline lyrics column. Sits to the right of <main> inside
 *  the outer scroller: `position: sticky` glues it to the top, beside the
 *  top bar, while main scrolls. That puts the scroller's scrollbar at the
 *  far right of the screen, past the panel, instead of squeezed between
 *  main and the panel. z-30 keeps it over the page. Mobile uses the
 *  NowPlaying overlay's scroll-to-lyrics flow instead. */
export function LyricsPanel() {
  const open = useUiStore((s) => s.lyricsOpen);
  const setOpen = useUiStore((s) => s.setLyricsOpen);

  if (!open) return null;

  return (
    <aside
      className="hidden md:flex flex-col shrink-0 self-start sticky z-30 border-l border-sidebar-border bg-sidebar text-sidebar-foreground"
      style={FULL_HEIGHT}
      aria-label="Lyrics"
    >
      <LyricsBody active={open} onClose={() => setOpen(false)} />
    </aside>
  );
}
