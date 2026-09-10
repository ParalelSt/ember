import Link from 'next/link';
import { HomeIcon, SearchIcon, LibraryIcon, SettingsIcon, ShieldIcon } from '@/components/icons';
import { isNavActive, type NavIcon, type NavItem } from '@/lib/nav';
import { cn } from '@/lib/utils';

export interface NavLinksProps {
  items: NavItem[];
  activePath: string;
  onNavigate?: () => void;
}

const ICONS: Record<NavIcon, typeof HomeIcon> = {
  home: HomeIcon,
  search: SearchIcon,
  library: LibraryIcon,
  settings: SettingsIcon,
  admin: ShieldIcon,
};

/** Presentational only: no data fetching, no store reads. Renders just the
 *  Link elements for the top nav; Sidebar and Drawer each keep their own
 *  wrapping <nav> since its padding differs between the two. */
export function NavLinks({ items, activePath, onNavigate }: NavLinksProps) {
  return (
    <>
      {items.map(({ href, label, icon }) => {
        const Icon = ICONS[icon];
        const isActive = isNavActive(href, activePath);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
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
    </>
  );
}
