'use client';

import { useState, type ReactNode } from 'react';
import { CollectionPage } from '@/components/library/CollectionPage';
import { ImportBanner } from '@/components/import/ImportBanner';
import { ReviewSheet } from '@/components/import/ReviewSheet';
import { StatusPill } from '@/components/import/parts';
import { Artwork } from '@/components/primitives/Artwork';
import { MusicIcon } from '@/components/icons';
import {
  MOCK_LIKED_TRACKS,
  MOCK_TRANSFER_JOB_DONE,
  MOCK_TRANSFER_JOB_RUNNING,
  MOCK_TRANSFER_REVIEW_ITEMS,
} from '@/app/(app)/dizajn/mock';
import type { TransferStateId } from '@/components/library/options/transfer';

// The Liked page while a transfer runs (plan 2.7): the real ImportBanner
// and ReviewSheet (components/import/, already shipped for playlist
// imports), a small "Transferring" block of pending rows above the real
// likes, and the real CollectionPage underneath, all fed mock data.

const PENDING_ROWS: { title: string; artist: string; status: 'added' | 'review' | 'not-found' }[] = [
  { title: 'Copper Sky', artist: 'Coastline', status: 'review' },
  { title: 'Field Notes (Live)', artist: 'Field Notes', status: 'not-found' },
  { title: 'Low Tide', artist: 'Aftertone', status: 'added' },
];

/** A source song not yet folded into the real likes list: art, title and
 *  either a checkmark (added) or the same pills the playlist rows use. */
function PendingRow({ row }: { row: (typeof PENDING_ROWS)[number] }) {
  return (
    <div data-testid="transfer-pending-row" data-status={row.status} className="flex items-center gap-row px-row py-cluster">
      <Artwork src={null} size="xs" className="grid shrink-0 place-items-center rounded bg-black text-foreground/20">
        <MusicIcon className="h-4 w-4" />
      </Artwork>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{row.title}</div>
        <div className="truncate text-xs text-muted-foreground">{row.artist}</div>
      </div>
      {row.status === 'added' ? (
        <span className="text-xs text-muted-foreground">Added</span>
      ) : (
        <StatusPill status={row.status} />
      )}
    </div>
  );
}

/** The block sitting above the real likes while songs are still being
 *  matched: not part of the list yet, just what the transfer has found so
 *  far. */
function TransferringBlock() {
  return (
    <div data-testid="transferring-block" className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {PENDING_ROWS.map((r) => (
        <PendingRow key={r.title} row={r} />
      ))}
    </div>
  );
}

function LikedBehind({ tracks, banner }: { tracks: typeof MOCK_LIKED_TRACKS; banner: ReactNode }) {
  return (
    <CollectionPage
      eyebrow="Playlist"
      title="Liked songs"
      meta={[`${tracks.length} songs`, '15 min']}
      cover={{ src: null, icon: 'heart' }}
      tracks={tracks}
      context={{ type: 'liked' }}
      playback={{ play: () => {}, shuffle: () => {}, shuffleOn: false, active: false }}
      download={null}
      banner={banner}
      trackActions={{
        currentId: null,
        isPlaying: false,
        likedIds: new Set(tracks.map((t) => t.id)),
        onPlay: () => {},
        onToggle: () => {},
        onLike: () => {},
      }}
      emptyMessage="No liked songs yet."
    />
  );
}

export function LikedPageStates({ state }: { state: TransferStateId }) {
  const [reviewOpen, setReviewOpen] = useState(false);

  if (state === 'idle') return <LikedBehind tracks={MOCK_LIKED_TRACKS} banner={undefined} />;

  if (state === 'running') {
    return (
      <LikedBehind
        tracks={MOCK_LIKED_TRACKS}
        banner={
          <div className="flex flex-col gap-row">
            <ImportBanner
              job={MOCK_TRANSFER_JOB_RUNNING}
              toReview={MOCK_TRANSFER_JOB_RUNNING.review}
              onStop={() => {}}
              onRetry={() => {}}
              onReview={() => setReviewOpen(true)}
              onDismiss={() => {}}
            />
            <TransferringBlock />
          </div>
        }
      />
    );
  }

  return (
    <>
      <LikedBehind
        tracks={MOCK_LIKED_TRACKS}
        banner={
          <ImportBanner
            job={MOCK_TRANSFER_JOB_DONE}
            toReview={MOCK_TRANSFER_JOB_DONE.review}
            onStop={() => {}}
            onRetry={() => {}}
            onReview={() => setReviewOpen(true)}
            onDismiss={() => {}}
          />
        }
      />
      <ReviewSheet
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        mode="review"
        playlistName="your Spotify data export"
        source="spotify"
        queue={MOCK_TRANSFER_REVIEW_ITEMS}
        index={0}
        previewId={null}
        previewPlaying={false}
        onPreview={() => {}}
        onPick={() => {}}
        onSkip={() => {}}
        onRemove={() => {}}
        searchResults={null}
        searching={false}
        onSearch={() => {}}
      />
    </>
  );
}
