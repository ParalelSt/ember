'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/components/providers/AuthProvider';
import { useCachedCollectionTracks, useQueryPlaylists } from '@/hooks/useLibrary';
import { useCreatePlaylistFlow } from '@/hooks/useCreatePlaylistFlow';
import { useImportJobs } from '@/hooks/useImports';
import { LIKED_NAV_KEY, navImportStates } from '@/lib/import/nav';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { CreatePlaylistDialog } from '@/components/track/menus/CreatePlaylistDialog';
import { CollectionNavList } from '@/components/nav/CollectionNavList';
import { NavLinks } from '@/components/nav/NavLinks';
import { WhatsNewLink } from '@/components/changelog/WhatsNewLink';
import { useChangelog } from '@/hooks/useChangelog';
import { PlaylistNavList } from '@/components/nav/PlaylistNavList';
import { useNavPlaylists } from '@/hooks/useNavPlaylists';
import { Avatar } from '@/components/primitives/Avatar';
import { ScanQrButton } from '@/components/auth/ScanQrButton';
import { FlameIcon, PlusIcon } from '@/components/icons';
import { BASE_NAV, ADMIN_NAV_ITEM } from '@/lib/nav';
import { hrefFor, navCollections, sharedLabel } from '@/lib/collections';
import { firstArts } from '@/lib/library';
import { useUiStore } from '@/stores/useUiStore';

/** The desktop sidebar. `covers` (a car head unit with the car layout
 *  switched off, owner's pick carlayout2): the same links as big rows with
 *  icons, and each playlist with its cover and song count. */
export function Sidebar({ covers = false }: { covers?: boolean }) {
  const pathname = usePathname();
  const { user, name: displayName, avatarUrl, isAdmin } = useAuth();
  const NAV = isAdmin ? [...BASE_NAV, ADMIN_NAV_ITEM] : BASE_NAV;
  const { data: playlists = [] } = useQueryPlaylists();
  const collectionTracks = useCachedCollectionTracks();
  const { hasNew } = useChangelog();
  const { createOpen, setCreateOpen, handleCreate } = useCreatePlaylistFlow();
  const { data: importJobs = [] } = useImportJobs();
  const importStates = navImportStates(importJobs);
  const nav = useNavPlaylists(
    playlists.map((p) => ({
      id: p.id,
      name: p.name,
      artworkUrl: p.artwork_url,
      trackArtworks: p.track_artworks,
      trackCount: p.track_count,
      href: hrefFor({ kind: 'playlist', id: p.id }),
      importState: importStates[p.id],
      sharedLabel: sharedLabel(p),
    })),
  );
  const setSearchOpen = useUiStore((s) => s.setSearchOpen);

  return (
    // Scrolls as a whole when the window is too short for it (a car head
    // unit, 480 to 600px tall): the playlists keep a few rows and the
    // profile row stays reachable instead of being cut off. `touch-hit`:
    // 44px hit boxes on a touch screen (globals.css).
    <aside className="touch-hit hidden md:flex flex-col w-(--sidebar-w) shrink-0 bg-sidebar text-sidebar-foreground border-r border-sidebar-border h-full overflow-x-hidden overflow-y-auto">
      <Link
        href="/"
        className="flex items-center gap-2 px-4 pt-5 pb-4 hover:opacity-80 transition-opacity"
        aria-label="Home"
      >
        <FlameIcon className="h-5 w-5 text-ember" />
        <span className="text-lg font-bold tracking-tight">Ember</span>
      </Link>

      <nav className="px-2 flex flex-col gap-1">
        <NavLinks items={NAV} activePath={pathname} onSearchClick={() => setSearchOpen(true)} size={covers ? 'lg' : 'md'} />
        <WhatsNewLink showNew={hasNew} activePath={pathname} />
      </nav>

      {user && (
        <div className="mt-4 border-t border-sidebar-border pt-3">
          <CollectionNavList
            items={navCollections().map(({ ref, title, href, icon }) => ({
                label: title,
                href,
                icon,
                count: collectionTracks[icon]?.length,
                artworks: firstArts(collectionTracks[icon] ?? []),
                importState: ref.kind === LIKED_NAV_KEY ? importStates[LIKED_NAV_KEY] : undefined,
              }))}
            activePath={pathname}
            size={covers ? 'lg' : 'md'}
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

      <ScrollArea className="flex-1 min-h-32 mt-2">
        <div className="px-2 pb-3 flex flex-col gap-0.5" {...nav.holdProps}>
          <PlaylistNavList
            items={nav.items}
            activePath={pathname}
            authed={!!user}
            onOpen={nav.onOpen}
            onTogglePin={nav.onTogglePin}
            covers={covers}
          />
        </div>
      </ScrollArea>

      {user && (
        <div className="mt-auto border-t border-sidebar-border px-2 py-3">
          {/* Approve a new device's sign-in QR (tablets; never the desktop). */}
          <ScanQrButton look="nav" />
          <Link
            href="/settings/profile"
            className="flex items-center gap-3 px-2 py-2 min-w-0 rounded-md hover:bg-sidebar-accent/60 transition-colors"
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

      <CreatePlaylistDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={handleCreate} />
    </aside>
  );
}
