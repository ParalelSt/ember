'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useAuth } from '@/components/providers/AuthProvider';
import { useQueryPlaylists } from '@/hooks/useLibrary';
import { useCreatePlaylistFlow } from '@/hooks/useCreatePlaylistFlow';
import { useImportJobs } from '@/hooks/useImports';
import { LIKED_NAV_KEY, navImportStates } from '@/lib/import/nav';
import { Button } from '@/components/ui/button';
import { CreatePlaylistDialog } from '@/components/track/menus/CreatePlaylistDialog';
import { CollectionNavList } from '@/components/nav/CollectionNavList';
import { NavLinks } from '@/components/nav/NavLinks';
import { WhatsNewLink } from '@/components/changelog/WhatsNewLink';
import { useChangelog } from '@/hooks/useChangelog';
import { PlaylistNavList } from '@/components/nav/PlaylistNavList';
import { Avatar } from '@/components/primitives/Avatar';
import { FlameIcon, PlusIcon } from '@/components/icons';
import { BASE_NAV, ADMIN_NAV_ITEM } from '@/lib/nav';
import { hrefFor, sharedLabel, systemCollections } from '@/lib/collections';
import { useUiStore } from '@/stores/useUiStore';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function Drawer({ open, onOpenChange }: Props) {
  const pathname = usePathname();
  const { user, name: displayName, avatarUrl, isAdmin } = useAuth();
  const NAV = isAdmin ? [...BASE_NAV, ADMIN_NAV_ITEM] : BASE_NAV;
  const { data: playlists = [] } = useQueryPlaylists();
  const { hasNew } = useChangelog();
  const { data: importJobs = [] } = useImportJobs();
  const importStates = navImportStates(importJobs);
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);

  const close = () => onOpenChange(false);
  const { createOpen, setCreateOpen, handleCreate } = useCreatePlaylistFlow(close);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-72 max-w-[82vw] flex flex-col bg-sidebar text-sidebar-foreground border-sidebar-border p-0">
        <SheetHeader className="px-4 py-4 border-b border-sidebar-border">
          <SheetTitle className="text-base">
            <Link
              href="/"
              onClick={close}
              className="flex items-center gap-2 hover:opacity-80 transition-opacity"
              aria-label="Home"
            >
              <FlameIcon className="h-4 w-4 text-ember" />
              Ember
            </Link>
          </SheetTitle>
        </SheetHeader>

        <nav className="px-2 py-3 flex flex-col gap-1">
          <NavLinks
            items={NAV}
            activePath={pathname}
            onNavigate={close}
            onSearchClick={() => setSearchOpen(true)}
          />
          <WhatsNewLink showNew={hasNew} activePath={pathname} onNavigate={close} />
        </nav>

        {user && (
          <div className="mt-4 border-t border-sidebar-border pt-3">
            <CollectionNavList
              items={systemCollections().map(({ ref, title, href, icon }) => ({
                label: title,
                href,
                icon,
                importState: ref.kind === LIKED_NAV_KEY ? importStates[LIKED_NAV_KEY] : undefined,
              }))}
              activePath={pathname}
              onNavigate={close}
            />
          </div>
        )}

        <div className="px-4 flex items-center justify-between border-t border-sidebar-border pt-3">
          <span className="text-[11px] uppercase tracking-widest text-sidebar-foreground/55">Playlists</span>
          {user && (
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setCreateOpen(true)} title="New playlist" aria-label="New playlist">
              <PlusIcon className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2 flex flex-col gap-0.5">
          <PlaylistNavList
            items={playlists.map((p) => ({
              id: p.id,
              name: p.name,
              href: hrefFor({ kind: 'playlist', id: p.id }),
              importState: importStates[p.id],
              sharedLabel: sharedLabel(p),
            }))}
            activePath={pathname}
            authed={!!user}
            onNavigate={close}
          />
        </div>

        {user && (
          <div className="border-t border-sidebar-border px-2 py-3">
            <Link
              href="/settings/profile"
              onClick={close}
              className="flex items-center gap-3 px-2 py-2 min-w-0 rounded-md hover:bg-sidebar-accent/60"
            >
              <Avatar
                src={avatarUrl}
                name={displayName}
                email={user.email}
                className="h-7 w-7 bg-ember text-ember-foreground text-xs"
              />
              <div className="text-xs text-sidebar-foreground/70 truncate" title={user.email}>
                {displayName || user.email}
              </div>
            </Link>
          </div>
        )}
      </SheetContent>
      <CreatePlaylistDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={handleCreate} onImported={close} />
    </Sheet>
  );
}
