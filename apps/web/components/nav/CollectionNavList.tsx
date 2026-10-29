import Link from 'next/link';
import { LikedSongsCover } from '@/components/library/LikedSongsCover';
import { LibraryCover } from '@/components/library/LibraryCover';
import { countLabel } from '@/lib/collections';
import { ImportTail } from '@/components/nav/PlaylistNavList';
import type { NavImportState } from '@/lib/import/nav';
import type { CollectionIcon } from '@/lib/collections';
import { cn } from '@/lib/utils';

export interface CollectionNavListProps {
  /** `importState` is only ever set on Liked songs, by a running transfer. */
  items: {
    label: string;
    href: string;
    icon: CollectionIcon;
    count?: number;
    artworks?: string[];
    importState?: NavImportState;
  }[];
  activePath: string;
  onNavigate?: () => void;
  /** 'lg': each icon on a cover-sized tile, the rows as tall as the
   *  playlists' cover rows under them (the head unit's covers sidebar). */
  size?: 'md' | 'lg';
}

/** Presentational only: no data fetching, no store reads. The three system
 *  collection links shown above "Playlists" in the Sidebar and Drawer. A
 *  transfer has no playlist, so its progress ring hangs here, on Liked
 *  songs. */
export function CollectionNavList({ items, activePath, onNavigate, size = 'md' }: CollectionNavListProps) {
  return (
    <div className="px-2 flex flex-col gap-0.5">
      {items.map(({ label, href, icon, count, artworks = [], importState }) => {
        const subtitle = icon === 'heart' ? 'Playlist' : icon === 'clock' ? 'Auto playlist' : 'Uploads';
        const isActive = activePath === href;
        const cover = size === 'lg' ? 'size-art-sm' : 'size-8';
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            data-testid={importState ? 'import-nav-row' : undefined}
            data-import={importState?.kind}
            className={cn(
              size === 'lg'
                ? 'flex items-center gap-row px-cluster py-inset rounded-md text-base transition-colors'
                : 'flex items-center gap-row px-cluster py-1.5 rounded-md text-sm transition-colors',
              isActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60',
            )}
          >
            {icon === 'heart' ? (
              <LikedSongsCover className={cn(cover, 'shrink-0 rounded-[4px]')} />
            ) : (
              <LibraryCover
                cover={{ kind: 'badge', badge: icon === 'clock' ? 'recent' : 'uploads', arts: artworks }}
                className={cn(cover, 'shrink-0 rounded-[4px]')}
              />
            )}
            <span className="min-w-0 flex-1">
              <span className={cn('block truncate text-sidebar-foreground', size === 'lg' ? 'text-base' : 'text-[14.5px] leading-4')}>{label}</span>
              <span className="block truncate text-xs leading-4 text-sidebar-foreground/55">
                {subtitle}{typeof count === 'number' ? ` · ${countLabel(count)}` : ''}
              </span>
            </span>
            {importState && <ImportTail state={importState} />}
          </Link>
        );
      })}
    </div>
  );
}
