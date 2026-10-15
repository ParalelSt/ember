'use client';

import { toast } from 'sonner';
import { ApproveSignIn } from '@/components/auth/ApproveSignIn';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import type { Credential, QrFacts } from '@/lib/qrLogin/client';

export const DECLINED_TOAST = 'Declined. That device was not signed in.';

/** The approve UI as a centered dialog over whatever page is open, so
 *  approving never leaves the page. Swipe-free on purpose: the
 *  scrim, Escape and Back just close it (the request stays pending and runs
 *  out by itself); only Not me declines. Approve hands over to the caller,
 *  which goes on to Settings > Devices; Not me closes it with a toast. A
 *  lookup or approve that fails stays in the dialog with a Close button. */
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
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-label="Sign in on another device?"
        data-testid="approve-sheet"
        className="gap-0 p-0 sm:max-w-md"
      >
        <div className="px-page py-stack">
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
      </DialogContent>
    </Dialog>
  );
}
