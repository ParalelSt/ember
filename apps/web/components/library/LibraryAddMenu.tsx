'use client';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CarIcon, DownloadIcon, ListPlusIcon, PlusIcon } from '@/components/icons';

export interface LibraryAddMenuProps {
  onNewPlaylist: () => void;
  onCarlist: () => void;
  onImport: () => void;
  /** A carlist is live for you: the carlist item opens it instead. */
  carlistLive?: boolean;
}

const ITEM = 'gap-row rounded-[9px] px-[10px] py-[11px] text-sm font-semibold [&_svg]:size-[22px] [&_svg]:text-muted-foreground';

/** Presentational only: the phone Library header's + button and its menu,
 *  New playlist, Start a carlist and Import. */
export function LibraryAddMenu({ onNewPlaylist, onCarlist, onImport, carlistLive = false }: LibraryAddMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        data-testid="library-add"
        aria-label="Create or import"
        className="grid size-[38px] place-items-center rounded-full text-foreground transition-colors hover:bg-secondary aria-expanded:bg-secondary"
      >
        <PlusIcon className="size-6" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[220px] rounded-[14px] p-[6px]">
        <DropdownMenuItem className={ITEM} onClick={onNewPlaylist}>
          <ListPlusIcon /> New playlist
        </DropdownMenuItem>
        <DropdownMenuItem className={ITEM} onClick={onCarlist}>
          <CarIcon /> {carlistLive ? 'Open your carlist' : 'Start a carlist'}
        </DropdownMenuItem>
        <DropdownMenuItem className={ITEM} onClick={onImport}>
          <DownloadIcon /> Import
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
