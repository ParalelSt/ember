'use client';

import { useEffect, useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useUiStore } from '@/stores/useUiStore';
import { LyricsBody } from './LyricsBody';

/** Below md the sheet portal renders even when its content has md:hidden —
 *  shadcn's SheetOverlay is a sibling and stays alive, leaving a stray
 *  blur backdrop on desktop. Gate the whole component on a real media
 *  query so the portal never mounts on PC. */
function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return isMobile;
}

export function LyricsSheet() {
  const open = useUiStore((s) => s.lyricsOpen);
  const setOpen = useUiStore((s) => s.setLyricsOpen);
  const isMobile = useIsMobile();

  if (!isMobile) return null;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="w-full sm:w-md sm:max-w-[90vw] flex flex-col bg-sidebar text-sidebar-foreground border-sidebar-border p-0"
      >
        <SheetHeader className="px-4 py-4 border-b border-sidebar-border">
          <SheetTitle className="text-base">Lyrics</SheetTitle>
        </SheetHeader>
        <LyricsBody active={open} showHeader={false} />
      </SheetContent>
    </Sheet>
  );
}
