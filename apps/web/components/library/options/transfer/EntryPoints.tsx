'use client';

import { CloudDownloadIcon } from '@/components/icons';
import { CollectionPage } from '@/components/library/CollectionPage';
import { Button } from '@/components/ui/button';
import { PageTitle } from '@/components/page/PageTitle';
import { MOCK_LIKED_TRACKS } from '@/app/(app)/dizajn/mock';
import { cn } from '@/lib/utils';
import type { TransferEntryId } from '@/components/library/options/transfer';
import { TransferDialog, type SourceTab } from '@/components/library/options/transfer/DestinationStep';
import type { TransferDestinationId } from '@/components/library/options/transfer';

// Where Transfer starts (plan 2.7, question 1), each candidate drawn
// behind its own dialog so the trigger and what it opens are one frame.

/** The Liked songs page, real CollectionPage on mock likes, with an extra
 *  header button where the "liked-button" candidate puts Transfer. */
function LikedBehind({ withTransferButton }: { withTransferButton: boolean }) {
  return (
    <CollectionPage
      eyebrow="Playlist"
      title="Liked songs"
      meta={[`${MOCK_LIKED_TRACKS.length} songs`, '15 min']}
      cover={{ src: null, icon: 'heart' }}
      tracks={MOCK_LIKED_TRACKS}
      context={{ type: 'liked' }}
      playback={{ play: () => {}, shuffle: () => {}, shuffleOn: false, active: false }}
      download={null}
      actions={
        withTransferButton ? (
          <Button variant="outline" size="sm" data-testid="transfer-entry-trigger">
            <CloudDownloadIcon className="h-4 w-4" />
            Transfer
          </Button>
        ) : undefined
      }
      trackActions={{
        currentId: null,
        isPlaying: false,
        likedIds: new Set(MOCK_LIKED_TRACKS.map((t) => t.id)),
        onPlay: () => {},
        onToggle: () => {},
        onLike: () => {},
      }}
      emptyMessage="No liked songs yet."
    />
  );
}

/** A mock Settings page with a Library section, the "settings-row"
 *  candidate's row inside it. */
function SettingsBehind() {
  const rows = [
    { label: 'Downloads', meta: 'What is kept for offline' },
    { label: 'Transfer from another app', meta: 'Bring your liked songs in', trigger: true },
    { label: 'Storage', meta: '1.2 GB used' },
  ];
  return (
    <div className="p-page">
      <PageTitle className="mb-stack">Settings</PageTitle>
      <div className="text-eyebrow mb-inset">Library</div>
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {rows.map((r) => (
          <button
            key={r.label}
            type="button"
            data-testid={r.trigger ? 'transfer-entry-trigger' : undefined}
            className="flex w-full items-center justify-between gap-row px-row py-cluster text-left hover:bg-card"
          >
            <span className="text-sm font-medium">{r.label}</span>
            <span className="text-xs text-muted-foreground">{r.meta}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const DIALOG_TABS = ['Start empty', 'Import from a link', 'Transfer'] as const;

/** The "third tab" candidate's tab strip, drawn above the shared dialog
 *  body (SourceTabs/DestinationControl), Transfer active. */
function DialogTabsLead() {
  return (
    <div role="tablist" aria-label="Create playlist" className="-mx-block -mt-block flex border-b border-border px-block">
      {DIALOG_TABS.map((t) => (
        <div
          key={t}
          role="tab"
          aria-selected={t === 'Transfer'}
          className={cn(
            'px-row py-cluster text-sm font-medium',
            t === 'Transfer' ? 'border-b-2 border-ember text-foreground' : 'text-muted-foreground',
          )}
        >
          {t}
        </div>
      ))}
    </div>
  );
}

export interface EntryPointPreviewProps {
  entry: TransferEntryId;
  phone: boolean;
  destination: TransferDestinationId;
  sourceTab: SourceTab;
  onSourceTab: (t: SourceTab) => void;
}

/** What each entry candidate renders behind the dialog, and the dialog
 *  itself (source + destination steps, shared across all three so the
 *  question stays "where does it start", not "what does it ask"). */
export function EntryPointBehind({ entry }: { entry: TransferEntryId }) {
  if (entry === 'settings-row') return <SettingsBehind />;
  return <LikedBehind withTransferButton={entry === 'liked-button'} />;
}

export function EntryPointDialog({ entry, phone, destination, sourceTab, onSourceTab }: EntryPointPreviewProps) {
  return (
    <TransferDialog
      destination={destination}
      phone={phone}
      sourceTab={sourceTab}
      onSourceTab={onSourceTab}
      lead={entry === 'dialog-tab' ? <DialogTabsLead /> : undefined}
      title={entry === 'dialog-tab' ? 'Create playlist' : 'Transfer songs'}
      entryImplied={
        destination === 'implicit'
          ? entry === 'dialog-tab'
            ? 'the Transfer tab, unlike Import from a link, always means likes'
            : 'opening Transfer always means likes'
          : undefined
      }
      onStart={() => {}}
    />
  );
}
