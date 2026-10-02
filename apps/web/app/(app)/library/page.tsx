'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CollectionShelf } from '@/components/library/CollectionShelf';
import { UploadTrackDialog } from '@/components/track/menus/UploadTrackDialog';
import { CarlistButton } from '@/components/session/CarlistButton';
import { UploadIcon } from '@/components/icons';
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
  const [uploadOpen, setUploadOpen] = useState(false);

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
        <div className="flex shrink-0 items-center gap-cluster">
          <CarlistButton />
          <Button
            variant="ghost"
            onClick={() => setUploadOpen(true)}
            aria-label="Upload"
            className="gap-1.5 text-muted-foreground hover:text-foreground"
          >
            {/* Icon only on a phone, so the title keeps one line next to Carlist. */}
            <UploadIcon className="h-4 w-4" /> <span className="hidden sm:inline">Upload</span>
          </Button>
        </div>
      </div>
      <UploadTrackDialog open={uploadOpen} onOpenChange={setUploadOpen} />

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
        items={playlists.map(({ title, subtitle, href, artworkUrl, downloaded, sharing }) => ({
          title,
          subtitle,
          href,
          cover: { src: artworkUrl, icon: null },
          badge: downloaded ? ('downloaded' as const) : undefined,
          shared: !!sharing,
          size: 'md' as const,
        }))}
        empty={<EmptyState>No playlists yet</EmptyState>}
      />
    </div>
  );
}
