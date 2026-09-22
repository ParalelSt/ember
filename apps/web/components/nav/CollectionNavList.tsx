import Link from 'next/link';
import { ClockIcon, HeartIcon, UploadIcon } from '@/components/icons';
import { ImportTail } from '@/components/nav/PlaylistNavList';
import type { NavImportState } from '@/lib/import/nav';
import type { CollectionIcon } from '@/lib/collections';
import { cn } from '@/lib/utils';

export interface CollectionNavListProps {
  /** `importState` is only ever set on Liked songs, by a running transfer. */
  items: { label: string; href: string; icon: CollectionIcon; importState?: NavImportState }[];
  activePath: string;
  onNavigate?: () => void;
}

const ICONS: Record<CollectionIcon, typeof HeartIcon> = {
  heart: HeartIcon,
  clock: ClockIcon,
  upload: UploadIcon,
};

/** Presentational only: no data fetching, no store reads. The three system
 *  collection links shown above "Playlists" in the Sidebar and Drawer. A
 *  transfer has no playlist, so its progress ring hangs here, on Liked
 *  songs. */
export function CollectionNavList({ items, activePath, onNavigate }: CollectionNavListProps) {
  return (
    <div className="px-2 flex flex-col gap-0.5">
      {items.map(({ label, href, icon, importState }) => {
        const Icon = ICONS[icon];
        const isActive = activePath === href;
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            data-testid={importState ? 'import-nav-row' : undefined}
            data-import={importState?.kind}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-md text-sm truncate transition-colors',
              isActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {importState && <ImportTail state={importState} />}
          </Link>
        );
      })}
    </div>
  );
}
