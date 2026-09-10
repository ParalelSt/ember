'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CollectionShelf } from '@/components/library/CollectionShelf';
import { ImportPlaylistDialog } from '@/components/track/ImportPlaylistDialog';
import { UploadTrackDialog } from '@/components/track/UploadTrackDialog';
import { StartSessionDialog, JoinSessionDialog } from '@/components/session/SessionDialogs';
import { DownloadIcon, QueueIcon, UploadIcon } from '@/components/icons';
import { useAuth } from '@/components/providers/AuthProvider';
import { useQueryHistory, useQueryLikes, useQueryPlaylists, useQueryUploads } from '@/hooks/useLibrary';
import { useOfflineStore } from '@/stores/useOfflineStore';
import { useOnline } from '@/lib/useOnline';
import { countLabel, hrefFor, iconFor, refFromPinId, systemCollections, type SystemKind } from '@/lib/collections';

export default function LibraryPage() {
  const { user } = useAuth();
  const { data: liked = [] } = useQueryLikes();
  const { data: history = [] } = useQueryHistory();
  const { data: playlists = [] } = useQueryPlaylists();
  const { data: uploads = [] } = useQueryUploads();
  const isOnline = useOnline();
  const downloaded = useOfflineStore((s) => s.downloaded);
  const pins = useOfflineStore((s) => s.pins);
  const [importOpen, setImportOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  if (!user) return <div className="text-muted-foreground py-12 text-center">Sign in to see your library</div>;

  // Offline: pins are the offline store's own record of what was downloaded,
  // so this renders correctly even before any online query has ever
  // succeeded (a cold start with no network yet).
  if (!isOnline) {
    return (
      <div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-2">Your library</h1>
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
            <div className="text-muted-foreground py-12 text-center">
              No downloaded playlists. Go online and tap “Download for offline” on a playlist to pin it.
            </div>
          }
        />
      </div>
    );
  }

  // Counts default to countLabel(0) via `?? []` above: a system collection's
  // query has no data yet on first paint, not "empty forever".
  const counts = { liked: liked.length, recent: history.length, uploads: uploads.length };

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Your library</h1>
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
        items={systemCollections().map(({ ref, title, href, pinId, icon }) => ({
          title,
          subtitle: countLabel(counts[ref.kind as SystemKind] ?? 0),
          href,
          cover: { src: null, icon },
          badge: downloaded.includes(pinId) ? ('downloaded' as const) : undefined,
          size: 'lg' as const,
        }))}
      />

      <CollectionShelf
        title="Playlists"
        size="md"
        items={playlists.map((p) => ({
          title: p.name,
          subtitle: downloaded.includes(p.id) ? 'Downloaded' : 'Playlist',
          href: hrefFor({ kind: 'playlist', id: p.id }),
          cover: { src: p.artwork_url, icon: null },
          badge: downloaded.includes(p.id) ? ('downloaded' as const) : undefined,
          size: 'md' as const,
        }))}
        empty={<div className="text-muted-foreground py-12 text-center">No playlists yet</div>}
      />
    </div>
  );
}
