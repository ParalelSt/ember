import Link from 'next/link';
import { ClockIcon, HeartIcon, UploadIcon } from '@/components/icons';
import type { CollectionIcon } from '@/lib/collections';
import { cn } from '@/lib/utils';

export interface CollectionNavListProps {
  items: { label: string; href: string; icon: CollectionIcon }[];
  activePath: string;
  onNavigate?: () => void;
}

const ICONS: Record<CollectionIcon, typeof HeartIcon> = {
  heart: HeartIcon,
  clock: ClockIcon,
  upload: UploadIcon,
};

/** Presentational only: no data fetching, no store reads. The three system
 *  collection links shown above "Playlists" in the Sidebar and Drawer. */
export function CollectionNavList({ items, activePath, onNavigate }: CollectionNavListProps) {
  return (
    <div className="px-2 flex flex-col gap-0.5">
      {items.map(({ label, href, icon }) => {
        const Icon = ICONS[icon];
        const isActive = activePath === href;
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-md text-sm truncate transition-colors',
              isActive
                ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60',
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </div>
  );
}
