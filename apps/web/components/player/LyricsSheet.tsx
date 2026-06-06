'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useUiStore } from '@/stores/useUiStore';
import { LyricsBody } from './LyricsBody';

/** Mobile (<md) lyrics overlay. Slides up over the player on phones
 *  where there's no width to spare for an inline column. Desktop uses
 *  LyricsPanel inline. */
export function LyricsSheet() {
  const open = useUiStore((s) => s.lyricsOpen);
  const setOpen = useUiStore((s) => s.setLyricsOpen);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="right"
        className="md:hidden w-full sm:w-md sm:max-w-[90vw] flex flex-col bg-sidebar text-sidebar-foreground border-sidebar-border p-0"
      >
        <SheetHeader className="px-4 py-4 border-b border-sidebar-border">
          <SheetTitle className="text-base">Lyrics</SheetTitle>
        </SheetHeader>
        <LyricsBody active={open} showHeader={false} />
      </SheetContent>
    </Sheet>
  );
}
