'use client';

import type { ReactNode } from 'react';
import { useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { CarIcon, KeyIcon } from '@/components/icons';
import { useBackDismiss } from '@/lib/useBackDismiss';

function Option({
  icon,
  title,
  sub,
  onClick,
  testId,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="flex w-full items-center gap-block rounded-2xl bg-secondary p-row text-left transition-colors outline-none hover:bg-accent active:bg-ember/20 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="flex size-[46px] shrink-0 items-center justify-center rounded-[14px] bg-ember/15 text-ember">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-base font-semibold text-foreground">{title}</span>
        <span className="block text-sm text-muted-foreground">{sub}</span>
      </span>
    </button>
  );
}

/** The Carlist menu as a centered dialog: two big option cards. It uses the
 *  shared Dialog (fixed, centered on both axes) so it sits in the middle of
 *  the screen on phone and desktop, never at the bottom edge.
 *  Back, Escape and the scrim close it. Picking an option closes the menu
 *  and hands over to the caller, which opens the matching dialog. */
export function CarlistSheet({
  open,
  onOpenChange,
  onStart,
  onJoin,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStart: () => void;
  onJoin: () => void;
}) {
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  useBackDismiss(open, close);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        data-testid="carlist-sheet"
        className="gap-0 p-0 sm:max-w-md"
      >
        <div className="px-page py-stack">
          <DialogTitle className="text-lg font-semibold">Carlist</DialogTitle>
          <DialogDescription className="sr-only">Start a carlist or join one.</DialogDescription>
          <div className="mt-block flex flex-col gap-row">
            <Option
              testId="carlist-start"
              icon={<CarIcon className="size-6" />}
              title="Start a carlist"
              sub="Share a list friends can add songs to in the car"
              onClick={() => {
                onOpenChange(false);
                onStart();
              }}
            />
            <Option
              testId="carlist-join"
              icon={<KeyIcon className="size-6" />}
              title="Join a carlist"
              sub="Scan or enter a code"
              onClick={() => {
                onOpenChange(false);
                onJoin();
              }}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
