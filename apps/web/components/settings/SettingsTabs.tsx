'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/settings/profile', label: 'Profile' },
  { href: '/settings/appearance', label: 'Appearance' },
  { href: '/settings/library', label: 'Library' },
  { href: '/settings/downloads', label: 'Downloads' },
  { href: '/settings/plugins', label: 'Plugins' },
  { href: '/settings/help', label: 'Help' },
];

export function SettingsTabs() {
  const path = usePathname();
  const activeRef = useRef<HTMLAnchorElement>(null);

  // Below md the tab row scrolls horizontally, so a tab picked from a link
  // elsewhere (or the section landed on directly) can start off-screen with
  // nothing on the page hinting there's more to scroll to. Bring it into
  // view whenever the active tab changes.
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [path]);

  return (
    <nav className="md:w-48 shrink-0 relative">
      <ul className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
        {TABS.map(({ href, label }) => {
          const active = path.startsWith(href);
          return (
            <li key={href}>
              <Link
                ref={active ? activeRef : undefined}
                href={href}
                className={cn(
                  'block px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
                  active
                    ? 'bg-card text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-card/60',
                )}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
      {/* Edge fades hint that the row scrolls, below md only (md:overflow-visible
          removes the scroller above that). bg-background (never a hardcoded
          colour) so it holds under every theme; pointer-events-none so it
          never blocks a tap on a tab underneath. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-0 w-block bg-linear-to-r from-background to-transparent md:hidden"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-block bg-linear-to-l from-background to-transparent md:hidden"
      />
    </nav>
  );
}
