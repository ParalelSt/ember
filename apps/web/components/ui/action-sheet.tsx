'use client';

import type { ComponentType, ReactNode } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

/** One action in a ⋯ menu, as data, so the same list can be a dropdown on
 *  desktop and an ActionSheet on a phone. */
export interface MenuAction {
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  onSelect: () => void;
  destructive?: boolean;
  /** Optional line of help under the label. */
  description?: string;
  /** Accessible name when it should differ from the label. */
  ariaLabel?: string;
}

/** The phone's ⋯ menu (owner's popups1 pick): a sheet up from the bottom with
 *  a grab handle, an optional header (the song or playlist it is about) and
 *  rows a thumb can hit. Same look as the full-screen player's More sheet. */
export function ActionSheet({
  open,
  onOpenChange,
  title,
  header,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Read out to screen readers; shown when there is no `header`. */
  title: string;
  header?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85vh] gap-0 overflow-y-auto rounded-t-2xl p-0"
        data-testid="action-sheet"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-cluster h-1 w-10 shrink-0 rounded-full bg-foreground/20" aria-hidden />
        <SheetHeader className={cn('px-block pt-row pb-cluster', !header && 'pb-0')}>
          {header ?? null}
          <SheetTitle className={header ? 'sr-only' : 'text-base'}>{title}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col px-cluster pb-stack">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

/** One row of an ActionSheet. */
export function ActionSheetItem({
  icon: Icon,
  children,
  onSelect,
  tone,
  disabled,
  trailing,
  testId,
  description,
  ariaLabel,
}: {
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
  onSelect?: () => void;
  tone?: 'ember' | 'destructive';
  disabled?: boolean;
  trailing?: ReactNode;
  testId?: string;
  /** A line of help under the label. */
  description?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={ariaLabel}
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        'flex min-h-12 w-full items-center gap-row rounded-lg px-row py-cluster text-left text-[15px] outline-none hover:bg-accent focus-visible:bg-accent disabled:opacity-60 disabled:hover:bg-transparent',
        tone === 'ember' && 'font-semibold text-ember',
        tone === 'destructive' && 'text-destructive',
      )}
    >
      {Icon && (
        <Icon className={cn('h-5 w-5 shrink-0', tone ? 'text-current' : 'text-muted-foreground')} />
      )}
      {description ? (
        <span className="min-w-0 flex-1">
          <span className="block truncate">{children}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">{description}</span>
        </span>
      ) : (
        <span className="min-w-0 flex-1 truncate">{children}</span>
      )}
      {trailing}
    </button>
  );
}

/** A small heading inside an ActionSheet. */
export function ActionSheetLabel({ children }: { children: ReactNode }) {
  return <div className="px-row pt-row pb-inset text-xs font-medium text-muted-foreground">{children}</div>;
}

/** A thin line between groups of rows in an ActionSheet. */
export function ActionSheetSeparator() {
  return <div role="separator" className="mx-row my-inset h-px shrink-0 bg-border" />;
}
