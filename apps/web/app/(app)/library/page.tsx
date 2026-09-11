'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CollectionShelf } from '@/components/library/CollectionShelf';
import { ImportPlaylistDialog } from '@/components/track/menus/ImportPlaylistDialog';
import { UploadTrackDialog } from '@/components/track/menus/UploadTrackDialog';
import { StartSessionDialog, JoinSessionDialog } from '@/components/session/SessionDialogs';
import { DownloadIcon, QueueIcon, UploadIcon } from '@/components/icons';
import { useAuth } from '@/components/providers/AuthProvider';
import { useCollections } from '@/hooks/useCollections';
import { useOfflineStore } from '@/stores/useOfflineStore';
import { useOnline } from '@/lib/useOnline';
import { hrefFor, iconFor, refFromPinId } from '@/lib/collections';
import { EmptyState } from '@/components/page/EmptyState';
import { PageTitle } from '@/components/page/PageTitle';

export default function LibraryPage() {
  const { user } = useAuth();
  const { system, playlists } = useCollections();
  const isOnline = useOnline();
  const pins = useOfflineStore((s) => s.pins);
  const [importOpen, setImportOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

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
          size="md"
          items={pins.map((p) => {
            const ref = refFromPinId(p.id);
            return {
              title: p.name,
              subtitle: 'Downloaded',
              href: hrefFor(ref),
              cover: { src: null, icon: iconFor(ref) },
              badge: 'downloaded' as const,
              size: 'md' as const,
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

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <PageTitle>Your library</PageTitle>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            onClick={() => setStartOpen(true)}
            className="gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <QueueIcon className="h-4 w-4" /> Session
          </Button>
          <Button
            variant="ghost"
            onClick={() => setJoinOpen(true)}
            className="text-muted-foreground hover:text-foreground"
          >
            Join
          </Button>
          <Button
            variant="ghost"
            onClick={() => setImportOpen(true)}
            className="gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <DownloadIcon className="h-4 w-4" /> Import
          </Button>
          <Button
            variant="ghost"
            onClick={() => setUploadOpen(true)}
            className="gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <UploadIcon className="h-4 w-4" /> Upload
          </Button>
        </div>
      </div>
      <ImportPlaylistDialog open={importOpen} onOpenChange={setImportOpen} />
      <UploadTrackDialog open={uploadOpen} onOpenChange={setUploadOpen} />
      <StartSessionDialog open={startOpen} onOpenChange={setStartOpen} />
      <JoinSessionDialog open={joinOpen} onOpenChange={setJoinOpen} />

      <CollectionShelf
        title="Your collections"
        size="lg"
        items={system.map(({ title, subtitle, href, icon, downloaded }) => ({
          title,
          subtitle,
          href,
          cover: { src: null, icon },
          badge: downloaded ? ('downloaded' as const) : undefined,
          size: 'lg' as const,
        }))}
      />

      <CollectionShelf
        title="Playlists"
        size="md"
        items={playlists.map(({ title, subtitle, href, artworkUrl, downloaded }) => ({
          title,
          subtitle,
          href,
          cover: { src: artworkUrl, icon: null },
          badge: downloaded ? ('downloaded' as const) : undefined,
          size: 'md' as const,
        }))}
        empty={<EmptyState>No playlists yet</EmptyState>}
      />
    </div>
  );
}
