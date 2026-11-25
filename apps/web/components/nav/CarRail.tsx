'use client';

import type { MouseEvent } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { HomeIcon, LibraryIcon, RadioIcon, SearchIcon, SettingsIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import { forgetNavigationIntent } from '@/lib/chunkReload';
import { pendingNavClick, pendingNavHandlers, usePendingNav } from '@/lib/pendingNav';

/** The rail's buttons, in the owner's order (carlayout2, option G). */
export const CAR_RAIL_NAV = [
  { href: '/', label: 'Home', icon: HomeIcon },
  { href: '/search', label: 'Search', icon: SearchIcon },
  { href: '/radio', label: 'Radio', icon: RadioIcon },
  { href: '/library', label: 'Library', icon: LibraryIcon },
] as const;

/** Which rail button is lit: Home only on Home; Library for everything in
 *  it (a playlist, Liked songs); the others by prefix. */
export function carRailActive(href: string, pathname: string): boolean {
  if (href === '/') return pathname === '/';
  if (href === '/library') return pathname.startsWith('/library') || pathname.startsWith('/playlist');
  return pathname.startsWith(href);
}

function RailButton({
  href,
  label,
  icon: Icon,
  active,
  pathname,
  onClick,
}: {
  href: string;
  label: string;
  icon: typeof HomeIcon;
  active: boolean;
  pathname: string;
  onClick?: (e: MouseEvent) => void;
}) {
  return (
    <Link
      href={href}
      {...pendingNavHandlers(href, pathname, !onClick)}
      onClick={(e) => {
        if (onClick) onClick(e);
        else pendingNavClick(e, href, pathname);
      }}
      data-perf-nonav={href === '/search' && onClick ? '' : undefined}
      aria-label={label}
      title={label}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'grid size-16 shrink-0 place-items-center rounded-xl transition-colors',
        active
          ? 'bg-ember text-ember-foreground'
          : 'bg-sidebar-accent text-sidebar-foreground/70 hover:text-sidebar-foreground',
      )}
    >
      <Icon className="size-8" />
    </Link>
  );
}

/** The head unit's car layout (hooks/useHeadUnit): a slim rail of big icon
 *  buttons in place of the sidebar, the active one filled in ember. Settings
 *  sits at the bottom, where the car layout is switched off again.
 *  `onSearchClick` opens the search overlay, like the sidebar's Search link
 *  (components/nav/NavLinks); /search stays the route under it. */
export function CarRail({ onSearchClick }: { onSearchClick: () => void }) {
  const pathname = usePathname();
  const pending = usePendingNav(pathname);
  const lit = (href: string, byRoute: boolean) => (pending ? pending === href : byRoute);
  return (
    <aside
      data-testid="car-rail"
      className="touch-hit hidden md:flex flex-col items-center gap-row w-24 shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border h-full overflow-y-auto py-block"
    >
      <nav aria-label="Main" className="flex flex-col items-center gap-row">
        {CAR_RAIL_NAV.map(({ href, label, icon }) => (
          <RailButton
            key={href}
            href={href}
            label={label}
            icon={icon}
            active={lit(href, carRailActive(href, pathname))}
            pathname={pathname}
            onClick={
              href === '/search'
                ? (e) => {
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    forgetNavigationIntent();
                    onSearchClick();
                  }
                : undefined
            }
          />
        ))}
      </nav>
      <div className="mt-auto">
        <RailButton href="/settings" label="Settings" icon={SettingsIcon} active={lit('/settings', pathname.startsWith('/settings'))} pathname={pathname} />
      </div>
    </aside>
  );
}
