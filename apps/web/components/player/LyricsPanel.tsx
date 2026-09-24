'use client';

import { useUiStore } from '@/stores/useUiStore';
import { useTopBarPreview } from '@/components/nav/TopBarPreviewSwitch';
import { cn } from '@/lib/utils';
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
  // PREVIEW ONLY (TopBarPreviewSwitch): in modes 1 to 3 the search bar is
  // sticky inside the scroller too, so the panel sticks just under it
  // (`--ember-topbar-h`, 0 in mode 4) and is that much shorter, and sits
  // over the bar's hanging covers (z-30; the bar goes to z-40 while its
  // results panel is open).
  const barInScroller = useTopBarPreview((s) => s.mode) !== 4;

  if (!open) return null;

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col w-md max-w-[40vw] shrink-0 self-start sticky top-0 border-l border-sidebar-border bg-sidebar text-sidebar-foreground',
        barInScroller && 'z-30',
      )}
      style={
        barInScroller
          ? { top: 'var(--ember-topbar-h, 0px)', height: 'calc(var(--ember-scroller-h, 100dvh) - var(--ember-topbar-h, 0px))' }
          : { height: 'var(--ember-scroller-h, 100dvh)' }
      }
      aria-label="Lyrics"
    >
      <LyricsBody active={open} onClose={() => setOpen(false)} />
    </aside>
  );
}
