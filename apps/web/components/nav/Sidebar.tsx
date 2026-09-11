'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { useQueryPlaylists } from '@/hooks/useLibrary';
import { useCreatePlaylistFlow } from '@/hooks/useCreatePlaylistFlow';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { CreatePlaylistDialog } from '@/components/track/menus/CreatePlaylistDialog';
import { ImportPlaylistDialog } from '@/components/track/menus/ImportPlaylistDialog';
import { CollectionNavList } from '@/components/nav/CollectionNavList';
import { NavLinks } from '@/components/nav/NavLinks';
import { PlaylistNavList } from '@/components/nav/PlaylistNavList';
import { FlameIcon, PlusIcon } from '@/components/icons';
import { BASE_NAV, ADMIN_NAV_ITEM } from '@/lib/nav';
import { hrefFor, systemCollections } from '@/lib/collections';

export function Sidebar() {
  const pathname = usePathname();
  const { user, name: displayName, avatarUrl, isAdmin } = useAuth();
  const NAV = isAdmin ? [...BASE_NAV, ADMIN_NAV_ITEM] : BASE_NAV;
  const { data: playlists = [] } = useQueryPlaylists();
  const { createOpen, setCreateOpen, handleCreate } = useCreatePlaylistFlow();
  const [importOpen, setImportOpen] = useState(false);

  return (
    <aside className="hidden md:flex flex-col w-(--sidebar-w) shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border h-full overflow-hidden">
      <Link
        href="/"
        className="flex items-center gap-2 px-4 pt-5 pb-4 hover:opacity-80 transition-opacity"
        aria-label="Home"
      >
        <FlameIcon className="h-5 w-5 text-ember" />
        <span className="text-lg font-bold tracking-tight">Ember</span>
      </Link>

      <nav className="px-2 flex flex-col gap-1">
        <NavLinks items={NAV} activePath={pathname} />
      </nav>

      {user && (
        <div className="mt-4 border-t border-sidebar-border pt-3">
          <CollectionNavList
            items={systemCollections().map(({ title, href, icon }) => ({ label: title, href, icon }))}
            activePath={pathname}
          />
        </div>
      )}

      <div className="mt-6 px-4 flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-widest text-sidebar-foreground/55">Playlists</span>
        {user && (
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setCreateOpen(true)} title="New playlist" aria-label="New playlist">
            <PlusIcon className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1 mt-2">
        <div className="px-2 pb-3 flex flex-col gap-0.5">
          <PlaylistNavList
            items={playlists.map((p) => ({ id: p.id, name: p.name, href: hrefFor({ kind: 'playlist', id: p.id }) }))}
            authed={!!user}
          />
        </div>
      </ScrollArea>

      {user && (
        <div className="mt-auto border-t border-sidebar-border px-2 py-3">
          <Link
            href="/settings/profile"
            className="flex items-center gap-3 px-2 py-2 min-w-0 rounded-md hover:bg-sidebar-accent/60 transition-colors"
          >
            <div className="relative h-7 w-7 rounded-full overflow-hidden bg-ember text-white grid place-items-center text-xs font-bold shrink-0">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
              ) : (
                (displayName || user.email)[0]?.toUpperCase() ?? '?'
              )}
            </div>
            <div className="text-xs text-sidebar-foreground/70 truncate" title={user.email}>
              {displayName || user.email}
            </div>
          </Link>
        </div>
      )}

      <CreatePlaylistDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={handleCreate} onImport={() => setImportOpen(true)} />
      <ImportPlaylistDialog open={importOpen} onOpenChange={setImportOpen} />
    </aside>
  );
}
