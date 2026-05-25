'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HomeIcon, SearchIcon, LibraryIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/', label: 'Home', icon: HomeIcon },
  { href: '/search', label: 'Search', icon: SearchIcon },
  { href: '/library', label: 'Library', icon: LibraryIcon },
];

export function MobileNav() {
  const pathname = usePathname();
  return (
    <nav
      className="md:hidden flex items-stretch justify-around bg-sidebar border-t border-sidebar-border"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      {NAV.map(({ href, label, icon: Icon }) => {
        const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
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
