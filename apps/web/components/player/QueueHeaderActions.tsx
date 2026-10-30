'use client';

import { useState } from 'react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';

/** The buttons' look, in one place: the owner picks their final style
 *  separately (plain small pills until then). */
const PILL =
  'inline-flex h-6 items-center rounded-full border border-sidebar-border px-cluster text-[11px] font-medium text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40';

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
      <button type="button" className={PILL} onClick={() => setConfirming(true)} disabled={count === 0} aria-label="Clear Next up">
        Clear
      </button>
      <button type="button" className={PILL} onClick={onShuffle} disabled={count < 2} aria-label="Shuffle Next up">
        Shuffle
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
