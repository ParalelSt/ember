'use client';

import { useLayoutEffect, type ReactNode } from 'react';
import Link from 'next/link';
import AdminUsersPage from '@/app/(app)/admin/users/page';
import { useRouter } from 'next/navigation';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import {
  useQueryAdminBackups,
  useQueryAdminInvites,
  useQueryAdminNativeLog,
  useQueryAdminTracks,
  useQueryAdminUsers,
} from '@/hooks/useAdmin';
import { ADMIN_SECTIONS, type AdminSectionId } from './sections';

/** /admin. Desktop redirects to Users before paint. A phone
 *  gets a two-column grid of section tiles, each with its count where one
 *  is known; a tile opens its section full screen. */
export function AdminHome() {
  const isDesktop = useIsDesktop();
  const router = useRouter();
  useLayoutEffect(() => {
    if (isDesktop) router.replace('/admin/users');
  }, [isDesktop, router]);
  // Keep the destination visible while the client navigation completes.
  if (isDesktop) return <AdminUsersPage />;
  return <AdminTiles />;
}

function AdminTiles() {
  const { data: users } = useQueryAdminUsers();
  const { data: invites } = useQueryAdminInvites();
  const { data: tracks } = useQueryAdminTracks(1, '');
  const { data: backups } = useQueryAdminBackups();
  // The Car page opens on all devices over 48 hours: the same query.
  const { data: carLog } = useQueryAdminNativeLog(undefined, 48);

  const devices = carLog?.devices.length;
  const counts: Partial<Record<AdminSectionId, ReactNode>> = {
    users: users?.length,
    invites: invites?.length,
    tracks: tracks?.totalItems,
    backups: backups?.backups.length,
    car:
      devices === undefined ? undefined : (
        <>
          {devices}
          <span className="ml-inset text-xs font-medium text-muted-foreground">
            {devices === 1 ? 'device' : 'devices'}
          </span>
        </>
      ),
  };

  return (
    <ul aria-label="Admin sections" data-testid="admin-tiles" className="grid grid-cols-2 gap-cluster md:hidden">
      {ADMIN_SECTIONS.map(({ id, href, label, icon: Icon }) => (
        <li key={id} className="min-w-0">
          <Link
            href={href}
            className="flex h-full min-h-24 flex-col gap-cluster rounded-2xl bg-card p-row transition-colors hover:bg-card/80"
          >
            <span className="grid size-9 place-items-center rounded-lg bg-muted text-ember">
              <Icon className="size-5" />
            </span>
            <span className="text-sm font-semibold">{label}</span>
            <span data-testid={`admin-tile-count-${id}`} className="mt-auto text-2xl font-bold leading-none tabular-nums">
              {counts[id] ?? null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
