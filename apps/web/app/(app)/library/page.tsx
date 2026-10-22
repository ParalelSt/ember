'use client';

import { useState } from 'react';
import { HeaderIconButton } from '@/components/page/HeaderIconButton';
import { CollectionShelf } from '@/components/library/CollectionShelf';
import { UploadTrackDialog } from '@/components/track/menus/UploadTrackDialog';
import { CarlistButton } from '@/components/session/CarlistButton';
import { PlusIcon, UploadIcon } from '@/components/icons';
import { useAuth } from '@/components/providers/AuthProvider';
import { useCollections } from '@/hooks/useCollections';
import { useOfflineStore } from '@/stores/useOfflineStore';
import { useOnline } from '@/lib/useOnline';
import { hrefFor, iconFor, playlistCover, refFromPinId } from '@/lib/collections';
import { EmptyState } from '@/components/page/EmptyState';
import { PageTitle } from '@/components/page/PageTitle';
import { PhoneLibrary } from '@/components/library/PhoneLibrary';
import { CreatePlaylistDialog } from '@/components/track/menus/CreatePlaylistDialog';
import { StartSessionDialog } from '@/components/session/SessionDialogs';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { usePhoneLibrary } from '@/hooks/usePhoneLibrary';
import { useLibraryView } from '@/hooks/useLibraryView';
import { useCreatePlaylistFlow } from '@/hooks/useCreatePlaylistFlow';
import { useQueryLiveCarlist } from '@/hooks/useSession';
import { useRouter } from 'next/navigation';
import { LIBRARY_IMPORT_HREF, LIBRARY_IMPORT_PLAYLIST_HREF } from '@/lib/library';

/** The phone Library's composition root: its data, the remembered view and
 *  the + menu's flows (New playlist, the carlist start dialog, Transfer). */
function PhoneLibraryPage() {
  const router = useRouter();
  const { user, name, avatarUrl } = useAuth();
  const { items, hasPlaylists, onOpenPlaylist } = usePhoneLibrary();
  const [view, setView] = useLibraryView();
  const { data: carlist } = useQueryLiveCarlist();
  const { createOpen, setCreateOpen, handleCreate } = useCreatePlaylistFlow();
  const [carlistOpen, setCarlistOpen] = useState(false);
  return (
    <>
      <PhoneLibrary
        items={items}
        hasPlaylists={hasPlaylists}
        profile={{ name, email: user?.email, avatarUrl }}
        view={view}
        onViewChange={setView}
        carlistLive={!!carlist}
        onOpenPlaylist={onOpenPlaylist}
        onNewPlaylist={() => setCreateOpen(true)}
        onCarlist={() => (carlist ? router.push(`/session/${carlist.id}`) : setCarlistOpen(true))}
        onImport={() => router.push(LIBRARY_IMPORT_HREF)}
        importPlaylistHref={LIBRARY_IMPORT_PLAYLIST_HREF}
      />
      <CreatePlaylistDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={handleCreate} />
      <StartSessionDialog open={carlistOpen} onOpenChange={setCarlistOpen} />
    </>
  );
}

export default function LibraryPage() {
  const { user } = useAuth();
  const { system, playlists } = useCollections();
  const isOnline = useOnline();
  const pins = useOfflineStore((s) => s.pins);
  const [uploadOpen, setUploadOpen] = useState(false);
  const { createOpen, setCreateOpen, handleCreate } = useCreatePlaylistFlow();
  // A phone gets the owner's Spotify-style list (components/library/
  // PhoneLibrary); md and up keep the shelves below. A media query, not md:
  // classes, so only one of the two is ever in the page.
  const isDesktop = useIsDesktop();

  if (!user) return <EmptyState>Sign in to see your library</EmptyState>;

  // Offline: pins are the offline store's own record of what was downloaded,
  // so this renders correctly even before any online query has ever
  // succeeded (a cold start with no network yet).
  if (!isOnline) {
    return (
      <div>
        <PageTitle className="mb-2">Your library</PageTitle>
        <p className="text-sm text-muted-foreground mb-6">Offline. Showing what is downloaded.</p>
        <CollectionShelf
          title="Downloaded"
          items={pins.map((p) => {
            const ref = refFromPinId(p.id);
            return {
              title: p.name,
              subtitle: 'Downloaded',
              href: hrefFor(ref),
              cover: { src: null, icon: iconFor(ref) },
              badge: 'downloaded' as const,
            };
          })}
          empty={
            <EmptyState>
              No downloaded playlists. Go online and tap “Download for offline” on a playlist to pin it.
            </EmptyState>
          }
        />
      </div>
    );
  }

  if (!isDesktop) return <PhoneLibraryPage />;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <PageTitle>Your library</PageTitle>
        <div className="flex shrink-0 items-center gap-cluster">
          <CarlistButton />
          <HeaderIconButton onClick={() => setUploadOpen(true)} aria-label="Upload songs" title="Upload songs">
            <UploadIcon className="size-5" />
          </HeaderIconButton>
          <HeaderIconButton onClick={() => setCreateOpen(true)} aria-label="New playlist" title="New playlist">
            <PlusIcon className="size-5" />
          </HeaderIconButton>
        </div>
      </div>
      <UploadTrackDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      <CreatePlaylistDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={handleCreate} />

      <CollectionShelf
        title="Your collections"
        items={system.map(({ title, subtitle, href, icon, downloaded }) => ({
          title,
          subtitle,
          href,
          cover: { src: null, icon },
          badge: downloaded ? ('downloaded' as const) : undefined,
        }))}
      />

      <CollectionShelf
        title="Playlists"
        items={playlists.map(({ title, subtitle, href, artworkUrl, trackArtworks, downloaded, sharing, sharedBy }) => ({
          title,
          subtitle,
          href,
          cover: { icon: null, ...playlistCover(artworkUrl, trackArtworks) },
          badge: downloaded ? ('downloaded' as const) : undefined,
          shared: !!sharing,
          sharedBy,
        }))}
        empty={<EmptyState>No playlists yet</EmptyState>}
      />
    </div>
  );
}
