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
import { WarningIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

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
  /** Confirming something that can't be taken back. On phones: a warning icon
   *  on top, everything centred, and Cancel and the action share the row as
   *  equal pills. Only max-md: classes, so desktop keeps the plain layout. */
  risky?: boolean;
}

// No X on the risky phone popup: Cancel sits right there, and the corner would
// fight the centred layout. The footer's band goes too, the pills are the row.
const RISKY_BOX = 'max-md:[&>[data-slot=dialog-close]]:hidden';
const RISKY_HEADER = 'max-md:items-center max-md:text-center';
const RISKY_TITLE = 'max-md:leading-snug';
const RISKY_FOOTER = 'max-md:flex-row max-md:border-t-0 max-md:bg-transparent max-md:pt-0';
// flex-1 without min-w-0, and tight sides: equal widths even for "Sign out
// everywhere" on a 390px phone. On a narrower one a long label pushes the other
// button instead of spilling out of its own.
const RISKY_BUTTON = 'max-md:flex-1 max-md:px-cluster';

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
  risky = false,
  className,
  ...content
}: PopupProps) {
  const inner = (
    <>
      <DialogHeader className={cn(risky && RISKY_HEADER)}>
        {risky && (
          <span
            data-testid="popup-risky-icon"
            aria-hidden="true"
            className="grid size-11 place-items-center rounded-full bg-destructive/15 text-destructive md:hidden"
          >
            <WarningIcon className="size-6" />
          </span>
        )}
        <DialogTitle className={cn(risky && RISKY_TITLE, titleClassName)}>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
      </DialogHeader>
      {children}
      <DialogFooter className={cn(risky && RISKY_FOOTER, footerClassName)}>
        {cancelLabel !== null && (
          <Button
            type="button"
            variant={cancelVariant}
            className={cn(risky && RISKY_BUTTON, risky && 'max-md:bg-secondary max-md:text-secondary-foreground')}
            onClick={() => onOpenChange(false)}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
        )}
        <Button
          type={onSubmit ? 'submit' : 'button'}
          variant={actionVariant}
          className={cn(risky && RISKY_BUTTON, actionClassName)}
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
      <DialogContent className={cn(risky && RISKY_BOX, className)} {...content}>
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
