'use client';

import { useUiStore } from '@/stores/useUiStore';
import { LyricsBody } from './LyricsBody';

/** Desktop (md:+) inline lyrics column. Sits to the right of <main> inside
 *  the outer scroller — `position: sticky` glues it to the top of the
 *  scroller's viewport while main scrolls. That puts the scroller's
 *  scrollbar at the far right of the screen, past the panel, instead of
 *  squeezed between main and the panel. Mobile uses the NowPlaying
 *  overlay's scroll-to-lyrics flow instead. */
export function LyricsPanel() {
  const open = useUiStore((s) => s.lyricsOpen);
  const setOpen = useUiStore((s) => s.setLyricsOpen);

  if (!open) return null;

  return (
    <aside
      className="hidden md:flex flex-col w-md max-w-[40vw] shrink-0 self-start sticky top-0 border-l border-sidebar-border bg-sidebar text-sidebar-foreground"
      style={{ height: 'var(--ember-scroller-h, 100dvh)' }}
      aria-label="Lyrics"
    >
      <LyricsBody active={open} onClose={() => setOpen(false)} />
    </aside>
  );
}
