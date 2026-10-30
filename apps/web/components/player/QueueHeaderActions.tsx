'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ShuffleIcon, TrashIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

/** The owner's "Icons only" pick: a 30px round icon button, muted until
 *  hovered, then the foreground colour on a soft round fill. The `after:`
 *  box grows the hit area to 44px (phone sized) without changing what is
 *  drawn. */
const ICON_BTN =
  'relative inline-flex size-7.5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 after:absolute after:-inset-[7px]';

/** Beside "Next up · N" (owner's pick "B. Clear and Shuffle"): Clear empties
 *  Next up after asking, Shuffle puts it in a random order once. The song
 *  playing is never touched. */
export function QueueHeaderActions({
  count,
  onClear,
  onShuffle,
  className,
}: {
  /** How many songs are in Next up: Shuffle needs two. */
  count: number;
  onClear: () => void;
  onShuffle: () => void;
  className?: string;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div data-testid="queue-header-actions" className={cn('flex shrink-0 items-center gap-inset', className)}>
      <button type="button" className={ICON_BTN} onClick={onShuffle} disabled={count < 2} aria-label="Shuffle Next up" title="Shuffle Next up">
        <ShuffleIcon className="size-4" />
      </button>
      <button type="button" className={ICON_BTN} onClick={() => setConfirming(true)} disabled={count === 0} aria-label="Clear Next up" title="Clear Next up">
        <TrashIcon className="size-4" />
      </button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Clear Next up?"
        description="The song playing now keeps playing."
        confirmLabel="Clear"
        variant="destructive"
        onConfirm={onClear}
      />
    </div>
  );
}
