'use client';

import Link from 'next/link';
import { HomeIcon, SearchIcon, LibraryIcon, RadioIcon, SettingsIcon, ShieldIcon } from '@/components/icons';
import { isNavActive, type NavIcon, type NavItem } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { forgetNavigationIntent } from '@/lib/chunkReload';
import { pendingNavClick, pendingNavHandlers, usePendingNav } from '@/lib/pendingNav';

export interface NavLinksProps {
  items: NavItem[];
  activePath: string;
  onNavigate?: () => void;
  /** Opens the search overlay instead of navigating, for the item whose
   *  icon is 'search'. /search stays a real route underneath (deep links,
   *  landing on it directly): a modified click (new tab, etc.) or a
   *  missing handler still navigates normally. */
  onSearchClick?: () => void;
  /** 'lg': big rows for a touch screen in a car (the head unit's covers
   *  sidebar, components/nav/Sidebar). */
  size?: 'md' | 'lg';
}

/** Active row at normal size: a soft ember wash, the plain foreground for the
 *  word (readable on any theme) and an ember icon. Shared with WhatsNewLink. */
export const ACTIVE_MD = 'bg-ember/14 text-sidebar-foreground';

const ICONS: Record<NavIcon, typeof HomeIcon> = {
  home: HomeIcon,
  search: SearchIcon,
  library: LibraryIcon,
  radio: RadioIcon,
  settings: SettingsIcon,
  admin: ShieldIcon,
};

/** Presentational only: no data fetching, no store reads. Renders just the
 *  Link elements for the top nav; Sidebar and Drawer each keep their own
 *  wrapping <nav> since its padding differs between the two. */
export function NavLinks({ items, activePath, onNavigate, onSearchClick, size = 'md' }: NavLinksProps) {
  const pending = usePendingNav(activePath);
  return (
    <>
      {items.map(({ href, label, icon }) => {
        const Icon = ICONS[icon];
        const isSearch = icon === 'search';
        // The search item opens an overlay, not a route: nothing to wait on.
        const navigates = !(isSearch && onSearchClick);
        const isActive = pending ? pending === href : isNavActive(href, activePath);
        return (
          <Link
            key={href}
            href={href}
            data-nav={label}
            data-perf-nonav={isSearch && onSearchClick ? '' : undefined}
            {...pendingNavHandlers(href, activePath, navigates)}
            onClick={(e) => {
              if (isSearch && onSearchClick && !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)) {
                e.preventDefault();
                forgetNavigationIntent();
                onSearchClick();
              } else if (navigates) pendingNavClick(e, href, activePath);
              onNavigate?.();
            }}
            className={cn(
              size === 'lg'
                ? 'flex min-h-12 items-center gap-row px-row rounded-lg text-base font-semibold transition-colors'
                : 'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
              isActive
                ? size === 'lg'
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : ACTIVE_MD
                : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60',
            )}
          >
            <Icon className={cn(size === 'lg' ? 'size-6' : 'h-4 w-4', isActive && size !== 'lg' && 'text-ember')} />
            {label}
          </Link>
        );
      })}
    </>
  );
}
