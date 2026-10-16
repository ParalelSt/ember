'use client';

import type { ComponentType, ReactNode } from 'react';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

interface AdminSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  'data-testid'?: string;
}

/** Admin's phone bottom sheet (a user's actions, Add invite, Edit track),
 *  shaped like Settings > Devices' sheet. */
export function AdminSheet({ open, onOpenChange, title, children, ...rest }: AdminSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        data-testid={rest['data-testid']}
        className="mx-auto max-h-[85vh] w-full max-w-lg gap-block overflow-y-auto rounded-t-2xl p-page"
      >
        <SheetTitle className="truncate text-base font-bold">{title}</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}

interface AdminSheetItemProps {
  icon: ComponentType<{ className?: string }>;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  /** Why it is disabled, shown as the tooltip. */
  title?: string;
  destructive?: boolean;
}

/** One row of an AdminSheet menu: a big, thumb-sized button. */
export function AdminSheetItem({ icon: Icon, children, onClick, disabled, title, destructive }: AdminSheetItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        'flex min-h-12 w-full items-center gap-row border-t border-border px-inset text-left text-base transition-colors',
        'hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
        destructive && 'text-destructive',
      )}
    >
      <Icon className="size-5 shrink-0" />
      {children}
    </button>
  );
}
