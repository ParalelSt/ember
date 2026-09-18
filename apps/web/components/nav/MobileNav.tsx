'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HomeIcon, SearchIcon, LibraryIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/', label: 'Home', icon: HomeIcon },
  { href: '/search', label: 'Search', icon: SearchIcon, isSearch: true },
  { href: '/library', label: 'Library', icon: LibraryIcon },
];

export interface MobileNavProps {
  /** Opens the search overlay instead of navigating to /search. /search
   *  stays a real route for deep links; a modified click still navigates. */
  onSearchClick?: () => void;
}

export function MobileNav({ onSearchClick }: MobileNavProps) {
  const pathname = usePathname();
  return (
    <nav
      className="md:hidden shrink-0 flex items-stretch justify-around bg-sidebar border-t border-sidebar-border"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {NAV.map(({ href, label, icon: Icon, isSearch }) => {
        const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={(e) => {
              if (isSearch && onSearchClick && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) {
                e.preventDefault();
                onSearchClick();
              }
            }}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-1 py-2 text-[11px] font-medium',
              isActive ? 'text-foreground' : 'text-foreground/55 hover:text-foreground/80',
            )}
          >
            <Icon className="h-5 w-5" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
