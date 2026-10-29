'use client';

import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ActionSheet, ActionSheetItem, type MenuAction } from '@/components/ui/action-sheet';
import { CarIcon, DownloadIcon, ListPlusIcon, PlusIcon } from '@/components/icons';
import { useIsDesktop } from '@/hooks/useIsDesktop';

export interface LibraryAddMenuProps {
  onNewPlaylist: () => void;
  onCarlist: () => void;
  onImport: () => void;
  /** A carlist is live for you: the carlist item opens it instead. */
  carlistLive?: boolean;
}

const ITEM = 'gap-row rounded-[9px] px-[10px] py-[11px] text-sm font-semibold [&_svg]:size-[22px] [&_svg]:text-muted-foreground';
const TRIGGER =
  'grid size-[38px] place-items-center rounded-full text-foreground transition-colors hover:bg-secondary aria-expanded:bg-secondary';

/** Presentational only: the phone Library header's + button and its menu,
 *  New playlist, Start a carlist and Import. A sheet from the bottom on a
 *  phone (popups1, like the song and playlist menus), a dropdown on desktop. */
export function LibraryAddMenu({ onNewPlaylist, onCarlist, onImport, carlistLive = false }: LibraryAddMenuProps) {
  const isDesktop = useIsDesktop();
  const [open, setOpen] = useState(false);
  const actions: MenuAction[] = [
    { key: 'new-playlist', label: 'New playlist', icon: ListPlusIcon, onSelect: onNewPlaylist },
    { key: 'carlist', label: carlistLive ? 'Open your carlist' : 'Start a carlist', icon: CarIcon, onSelect: onCarlist },
    { key: 'import', label: 'Import', icon: DownloadIcon, onSelect: onImport },
  ];

  if (!isDesktop) {
    return (
      <>
        <button
          type="button"
          data-testid="library-add"
          aria-label="Create or import"
          aria-haspopup="dialog"
          aria-expanded={open}
          className={TRIGGER}
          onClick={() => setOpen(true)}
        >
          <PlusIcon className="size-6" />
        </button>
        <ActionSheet open={open} onOpenChange={setOpen} title="Create or import">
          {actions.map((a) => (
            <ActionSheetItem
              key={a.key}
              icon={a.icon}
              testId={`library-add-${a.key}`}
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
      <DropdownMenuTrigger data-testid="library-add" aria-label="Create or import" className={TRIGGER}>
        <PlusIcon className="size-6" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[220px] rounded-[14px] p-[6px]">
        {actions.map((a) => (
          <DropdownMenuItem key={a.key} className={ITEM} onClick={a.onSelect}>
            <a.icon /> {a.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
