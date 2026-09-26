'use client';

import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { EqualizerPanel } from '@/components/settings/EqualizerPanel';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** The equalizer from the full-screen player: the same controls as
 *  Settings > Plugins, in a sheet from the bottom so the song keeps playing
 *  in view while the sound is shaped. */
export function EqualizerSheet({ open, onOpenChange }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-2xl p-0">
        <SheetHeader className="px-block pt-block pb-0">
          <SheetTitle className="text-base">Sound</SheetTitle>
        </SheetHeader>
        <EqualizerPanel className="px-block pb-stack" />
      </SheetContent>
    </Sheet>
  );
}
