'use client';

import { toast } from 'sonner';
import { ApproveSignIn } from '@/components/auth/ApproveSignIn';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import type { Credential, QrFacts } from '@/lib/qrLogin/client';

export const DECLINED_TOAST = 'Declined. That device was not signed in.';

/** The approve UI as a bottom sheet over whatever page is open (owner's
 *  pick), so approving never leaves the page. Swipe-free on purpose: the
 *  scrim, Escape and Back just close it (the request stays pending and runs
 *  out by itself); only Not me declines. Approve hands over to the caller,
 *  which goes on to Settings > Devices; Not me closes it with a toast. A
 *  lookup or approve that fails stays in the sheet with a Close button. */
export function ApproveSheet({
  credential,
  onClose,
  onApproved,
}: {
  credential: Credential;
  onClose: () => void;
  onApproved: (facts: QrFacts) => void;
}) {
  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetContent
        side="bottom"
        showCloseButton={false}
        aria-label="Sign in on another device?"
        data-testid="approve-sheet"
        className="mx-auto w-full max-w-lg gap-0 rounded-t-3xl p-0 outline-none sm:border-x"
      >
        <div className="mx-auto mt-cluster h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
        <div className="px-page pt-block pb-stack">
          <ApproveSignIn
            credential={credential}
            onClose={onClose}
            onDone={(result, facts) => {
              if (result === 'done') onApproved(facts);
              else if (result === 'denied') {
                toast(DECLINED_TOAST);
                onClose();
              }
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
