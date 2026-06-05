'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const TABS = [
  { href: '/settings/profile', label: 'Profile' },
  { href: '/settings/help', label: 'Help' },
];

export function SettingsTabs() {
  const path = usePathname();
  return (
    <nav className="md:w-48 shrink-0">
      <ul className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible">
        {TABS.map(({ href, label }) => {
          const active = path.startsWith(href);
          return (
            <li key={href}>
              <Link
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
    </nav>
  );
}
