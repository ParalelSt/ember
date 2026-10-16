'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ADMIN_SECTIONS } from './sections';

/** Admin's section tabs, md and up only. A phone gets the section tiles on
 *  /admin instead (AdminHome) and a back arrow in each section
 *  (AdminSectionBar). */
export function AdminTabs() {
  const path = usePathname();
  return (
    <nav className="hidden md:block lg:w-48 shrink-0">
      <ul className="flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible">
        {ADMIN_SECTIONS.map(({ href, label }) => {
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
