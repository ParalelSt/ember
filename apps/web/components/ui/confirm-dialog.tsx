'use client';

import { useState } from 'react';
import { Popup } from '@/components/ui/popup';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "destructive" turns the confirm button red, for deletes etc. */
  variant?: 'default' | 'destructive';
  /** Called when the user confirms. The dialog awaits the promise and closes
   *  on resolve. Throw to keep it open (after saying why: the dialog shows
   *  nothing itself). */
  onConfirm: () => void | Promise<void>;
}

/** Reusable in-app confirmation dialog, replaces window.confirm so the
 *  experience stays inside the app's styling. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  onConfirm,
}: Props) {
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // The caller said why (its own toast); stay open to try again. Not
      // rethrown: the click handler's promise has no one to catch it, so
      // it became an unhandled rejection and an automatic bug report.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Popup
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-sm"
      title={title}
      description={description}
      cancelLabel={cancelLabel}
      actionLabel={confirmLabel}
      busyLabel="…"
      busy={busy}
      onAction={handleConfirm}
      actionVariant={variant === 'destructive' ? 'default' : 'ember'}
      actionClassName={cn(variant === 'destructive' && 'bg-destructive hover:bg-destructive/90 text-white')}
      footerClassName="mt-2"
    />
  );
}
