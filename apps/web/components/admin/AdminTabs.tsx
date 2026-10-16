'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useQueryAdminUsers, useQueryAdminInvites, useQueryAdminTracks, useQueryAdminBackups, useQueryAdminNativeLog } from '@/hooks/useAdmin';
import { ADMIN_SECTIONS } from './sections';

/** Desktop section navigation. Phone navigation stays in AdminHome. */
export function AdminTabs() {
  const isDesktop = useIsDesktop();
  return isDesktop ? <DesktopSections /> : null;
}

function DesktopSections() {
  const path = usePathname();
  const { data: users } = useQueryAdminUsers();
  const { data: invites } = useQueryAdminInvites();
  const { data: tracks } = useQueryAdminTracks(1, '');
  const { data: backups } = useQueryAdminBackups();
  const { data: car } = useQueryAdminNativeLog(undefined, 48);
  const counts: Record<string, number | undefined> = {
    users: users?.length, invites: invites?.length, tracks: tracks?.totalItems,
    backups: backups?.backups.length, car: car?.devices.length,
  };
  return (
    <nav aria-label="Admin sections" className="hidden md:block w-40 lg:w-48 shrink-0">
      <ul className="flex flex-col gap-inset">
        {ADMIN_SECTIONS.map(({ id, href, label, icon: Icon }) => {
          const active = path.startsWith(href) || (path === '/admin' && id === 'users');
          return (
            <li key={href}>
              <Link href={href} aria-current={active ? 'page' : undefined}
                className={cn('flex items-center gap-cluster px-cluster py-cluster rounded-md text-sm font-medium transition-colors',
                  active ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-card/60')}>
                <Icon className="size-4 shrink-0" />
                <span className="min-w-0 flex-1">{label}</span>
                {counts[id] !== undefined && <span className="text-xs tabular-nums text-muted-foreground">{counts[id]}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
