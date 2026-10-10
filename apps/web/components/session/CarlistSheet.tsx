'use client';

import type { ReactNode } from 'react';
import { useCallback } from 'react';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
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

/** The Carlist menu as a bottom sheet (owner's pick): two big option cards.
 *  Back, Escape and the scrim close it. Picking an option closes the sheet
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
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        data-testid="carlist-sheet"
        className="mx-auto w-full max-w-lg gap-0 rounded-t-3xl p-0 outline-none sm:border-x"
      >
        <div className="mx-auto mt-cluster h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
        <div className="px-page pt-block pb-stack">
          <SheetTitle className="text-lg font-semibold">Carlist</SheetTitle>
          <SheetDescription className="sr-only">Start a carlist or join one.</SheetDescription>
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
      </SheetContent>
    </Sheet>
  );
}
