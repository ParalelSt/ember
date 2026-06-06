'use client';

import { useUiStore } from '@/stores/useUiStore';
import { LyricsBody } from './LyricsBody';

/** Desktop (md:+) inline lyrics column. Sits to the right of <main> and
 *  pushes the layout to make room — no overlay, controls stay reachable.
 *  Mobile uses the NowPlaying overlay's scroll-to-lyrics flow instead
 *  since there's no width to spare. */
export function LyricsPanel() {
  const open = useUiStore((s) => s.lyricsOpen);
  const setOpen = useUiStore((s) => s.setLyricsOpen);

  if (!open) return null;

  return (
    <aside
      className="hidden md:flex flex-col w-md max-w-[40vw] shrink-0 border-l border-sidebar-border bg-sidebar text-sidebar-foreground"
      aria-label="Lyrics"
    >
      <LyricsBody active={open} onClose={() => setOpen(false)} />
    </aside>
  );
}
