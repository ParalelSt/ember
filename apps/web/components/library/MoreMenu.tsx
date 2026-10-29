'use client';

import { Fragment, useState, type ReactNode } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ActionSheet, ActionSheetItem, type MenuAction } from '@/components/ui/action-sheet';
import { MoreIcon } from '@/components/icons';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { ACTION_CIRCLE } from '@/components/page/ActionBar';

export interface MoreMenuProps {
  actions: MenuAction[];
  /** The ⋯ button's accessible name ("Playlist options"). */
  label?: string;
  /** Shown on top of the phone sheet (the playlist's name). */
  name?: string;
  testId?: string;
}

/** Presentational only: a collection's ⋯ in its action bar (Copy songs
 *  to…, Edit order, a playlist's Collaborate/Rename/Delete). A dropdown on
 *  desktop, a sheet from the bottom on a phone (owner's popups1 pick). A
 *  destructive row sits under a line. */
export function MoreMenu({ actions, label = 'More options', name, testId = 'more-menu' }: MoreMenuProps) {
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  if (actions.length === 0) return null;
  const icon = <MoreIcon className="size-5" />;

  if (!isDesktop) {
    const header: ReactNode = name ? <div className="truncate text-left text-base font-semibold">{name}</div> : undefined;
    return (
      <>
        <button
          type="button"
          data-testid={testId}
          aria-label={label}
          aria-haspopup="dialog"
          className={ACTION_CIRCLE}
          onClick={() => setOpen(true)}
        >
          {icon}
        </button>
        <ActionSheet open={open} onOpenChange={setOpen} title={name ? `${name} options` : label} header={header}>
          {actions.map((a) => (
            <ActionSheetItem
              key={a.key}
              icon={a.icon}
              tone={a.destructive ? 'destructive' : undefined}
              testId={`menu-${a.key}`}
              onSelect={() => {
                setOpen(false);
                a.onSelect();
              }}
            >
              {a.label}
            </ActionSheetItem>
          ))}
        </ActionSheet>
      </>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger data-testid={testId} aria-label={label} className={ACTION_CIRCLE}>
        {icon}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-52">
        {actions.map((a, i) => (
          <Fragment key={a.key}>
            {a.destructive && i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem
              data-testid={`menu-${a.key}`}
              variant={a.destructive ? 'destructive' : undefined}
              onClick={a.onSelect}
            >
              <a.icon /> {a.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
