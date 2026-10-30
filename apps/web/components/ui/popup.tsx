'use client';

import type { ComponentProps, FormEventHandler, ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

type ButtonVariant = ComponentProps<typeof Button>['variant'];

interface PopupProps extends Omit<ComponentProps<typeof DialogContent>, 'title' | 'children' | 'onSubmit'> {
  open: boolean;
  /** Also what Cancel calls, with false, so every way out runs the same code.
   *  To hold the popup open while busy, guard it here. */
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  titleClassName?: string;
  children?: ReactNode;
  /** null leaves the Cancel button out. */
  cancelLabel?: ReactNode;
  cancelVariant?: ButtonVariant;
  actionLabel: ReactNode;
  /** Shown on the action button while busy; the plain label if left out. */
  busyLabel?: ReactNode;
  /** Disables both buttons. */
  busy?: boolean;
  /** Disables the action only (nothing to send yet). */
  actionDisabled?: boolean;
  actionVariant?: ButtonVariant;
  actionClassName?: string;
  /** The action button's click, for a popup without a form. */
  onAction?: () => void;
  /** Wraps the popup in a form and makes the action its submit button, so
   *  Enter in a field sends it. Call preventDefault here. */
  onSubmit?: FormEventHandler<HTMLFormElement>;
  footerClassName?: string;
}

/** The one small popup: a title, an optional description, content, and Cancel
 *  plus a primary action. Everything else (className, data-*, showCloseButton)
 *  goes to DialogContent, which owns the box, its centring above the keyboard
 *  and its focus handling. */
export function Popup({
  open,
  onOpenChange,
  title,
  description,
  titleClassName,
  children,
  cancelLabel = 'Cancel',
  cancelVariant = 'ghost',
  actionLabel,
  busyLabel,
  busy = false,
  actionDisabled = false,
  actionVariant = 'ember',
  actionClassName,
  onAction,
  onSubmit,
  footerClassName,
  ...content
}: PopupProps) {
  const inner = (
    <>
      <DialogHeader>
        <DialogTitle className={titleClassName}>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      {children}
      <DialogFooter className={footerClassName}>
        {cancelLabel !== null && (
          <Button type="button" variant={cancelVariant} onClick={() => onOpenChange(false)} disabled={busy}>
            {cancelLabel}
          </Button>
        )}
        <Button
          type={onSubmit ? 'submit' : 'button'}
          variant={actionVariant}
          className={actionClassName}
          onClick={onSubmit ? undefined : onAction}
          disabled={busy || actionDisabled}
        >
          {busy && busyLabel !== undefined ? busyLabel : actionLabel}
        </Button>
      </DialogFooter>
    </>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent {...content}>
        {/* contents: the header, content and footer stay direct children of
            the box's grid, with or without a form. */}
        {onSubmit ? (
          <form onSubmit={onSubmit} className="contents">
            {inner}
          </form>
        ) : (
          inner
        )}
      </DialogContent>
    </Dialog>
  );
}
