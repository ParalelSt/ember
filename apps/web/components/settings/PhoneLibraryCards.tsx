'use client';

import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import { BlockIcon, MusicIcon, UploadIcon } from '@/components/icons';
import { Artwork } from '@/components/primitives/Artwork';
import { useBlockedTracks } from '@/hooks/useBlockedTracks';
import { cn } from '@/lib/utils';

/** The Transfer page, returning to Settings > Uploads when it is done or left. */
export const PHONE_TRANSFER_HREF = `/transfer?from=${encodeURIComponent('/settings/uploads')}`;

/** Phone Settings > Uploads: bringing songs liked somewhere else into Ember
 *  (the same Transfer page as the button on Liked songs). It used to be the
 *  Library page, which duplicated the sidebar's Library. */
export function TransferCard() {
  return (
    <div className="flex items-start justify-between gap-block rounded-2xl bg-card p-stack shadow-soft">
      <div className="min-w-0">
        <div className="font-semibold">Transfer from another app</div>
        <p className="mt-inset text-sm text-muted-foreground">
          Bring the songs you liked on Spotify, Apple Music or anywhere else into Ember. Upload
          your data export or a CSV, paste a list of songs, or paste a public playlist link. They
          become your likes, or a new playlist, and Ember matches them on YouTube Music in the
          background.
        </p>
      </div>
      <Link
        href={PHONE_TRANSFER_HREF}
        className={cn(buttonVariants({ variant: 'ember' }), 'shrink-0')}
        data-testid="settings-transfer-button"
      >
        <UploadIcon className="h-4 w-4" />
        Transfer
      </Link>
    </div>
  );
}

/** Phone Settings > Profile: the songs you blocked from radio, mixes and
 *  suggestions, to unblock. */
export function BlockedSongsCard() {
  const { blocked, unblock } = useBlockedTracks();
  return (
    <div className="rounded-2xl bg-card p-stack shadow-soft" data-testid="blocked-songs">
      <div className="font-semibold">Blocked songs</div>
      <p className="mt-inset text-sm text-muted-foreground">
        These never come up in radio, mixes or suggestions. You can still play them yourself.
        Block a song from its ⋯ menu.
      </p>
      {blocked.length === 0 ? (
        <div className="mt-block flex items-center gap-cluster text-sm text-muted-foreground">
          <BlockIcon className="h-4 w-4" /> No blocked songs.
        </div>
      ) : (
        <ul className="mt-block flex flex-col gap-cluster">
          {blocked.map((t) => (
            <li key={t.id} className="flex items-center gap-row">
              <Artwork src={t.artworkUrl} className="size-10 shrink-0 rounded-md bg-art">
                <div className="grid h-full w-full place-items-center text-foreground/30">
                  <MusicIcon className="h-4 w-4" />
                </div>
              </Artwork>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{t.title}</div>
                <div className="truncate text-xs text-muted-foreground">{t.artist}</div>
              </div>
              <Button variant="outline" size="sm" onClick={() => void unblock(t)} aria-label={`Unblock ${t.title}`}>
                Unblock
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
