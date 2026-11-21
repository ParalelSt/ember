'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@legacy/components/ui/button';
import { useUiMode } from '@/components/providers/UiModeProvider';

/** The way back to the new design, at the top of the Classic look's
 *  Settings: the one thing added to the frozen UI (RULES.md "Classic look").
 *  Switches this device (lib/uiMode) and reloads. */
export function TryNewLookCard() {
  const { setMode } = useUiMode();
  const [busy, setBusy] = useState(false);

  const tryIt = async () => {
    setBusy(true);
    try {
      await setMode('new');
    } catch {
      toast.error("Couldn't switch the look. Check your connection and try again.");
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="try-new-look"
      className="mb-6 flex flex-col gap-block rounded-2xl bg-card p-block shadow-soft sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <div className="font-semibold">Try the new look</div>
        <p className="mt-inset text-sm text-muted-foreground">
          Ember has a new design. Switch to it on this device, and come back any time in Settings &gt; Appearance &gt;
          Classic look.
        </p>
      </div>
      <Button variant="ember" className="shrink-0" disabled={busy} onClick={() => void tryIt()}>
        Try it
      </Button>
    </div>
  );
}
