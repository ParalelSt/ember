'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CloseIcon, LinkIcon, MusicIcon, UploadIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import type { TransferDestinationId } from '@/components/library/options/transfer';

// The source step (how link, file and pasted text sit together) and the
// destination step (how "these go to my likes" is said) as one dialog, the
// Task 0 candidates from docs/superpowers/plans/2026-09-22-transfer-liked-songs.md
// section 2.7. Drawn in place (not portalled), same pattern as
// options/imports/ImportDialog.tsx's DialogFrame, so it sits inside the
// gallery's shell frame.

type SourceTab = 'link' | 'file' | 'paste';

const SOURCE_TABS: { id: SourceTab; label: string; help: string }[] = [
  {
    id: 'link',
    label: 'Paste a link',
    help: 'A public Spotify playlist link, or a YouTube Music playlist link.',
  },
  {
    id: 'file',
    label: 'Upload a file',
    help: "Your Spotify data export (Account > Privacy settings > Request data), or a CSV from Exportify and similar tools, works as it is.",
  },
  {
    id: 'paste',
    label: 'Paste text',
    help:
      'For YouTube Music liked songs: open its page, open your browser’s developer tools on a computer, and paste the request headers here. One-time only, nothing is stored beyond this transfer.',
  },
];

function SourceTabs({ tab, onTab }: { tab: SourceTab; onTab: (t: SourceTab) => void }) {
  const active = SOURCE_TABS.find((t) => t.id === tab)!;
  return (
    <div data-testid="transfer-source-step" className="flex flex-col gap-row">
      <div role="tablist" aria-label="How to bring your songs in" className="flex gap-inset rounded-lg bg-muted p-inset">
        {SOURCE_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            onClick={() => onTab(t.id)}
            className={cn(
              'flex-1 rounded-md px-cluster py-inset text-xs font-medium transition-colors',
              t.id === tab ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'link' && (
        <div className="relative">
          <LinkIcon className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Playlist link" placeholder="https://open.spotify.com/playlist/…" className="pl-9" readOnly />
        </div>
      )}
      {tab === 'file' && (
        <div className="flex flex-col items-center gap-cluster rounded-lg border border-dashed border-border py-block text-center">
          <UploadIcon className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm">Drop a file here, or tap to browse</span>
          <span className="text-xs text-muted-foreground">.json, .csv or .zip</span>
        </div>
      )}
      {tab === 'paste' && (
        <textarea
          aria-label="Pasted request headers"
          readOnly
          rows={3}
          placeholder="Paste what developer tools copied…"
          className="w-full resize-none rounded-lg border border-border bg-transparent px-row py-cluster text-sm"
        />
      )}
      <p data-testid="transfer-source-help" className="text-xs text-muted-foreground">
        {active.help}
      </p>
    </div>
  );
}

function DestinationControl({ destination, entryImplied }: { destination: TransferDestinationId; entryImplied?: string }) {
  if (destination === 'segmented') {
    return (
      <div data-testid="transfer-destination" data-destination={destination}>
        <div className="mb-inset text-eyebrow">Add these to</div>
        <div role="radiogroup" aria-label="Destination" className="inline-flex rounded-lg bg-muted p-inset">
          <button type="button" role="radio" aria-checked="true" className="rounded-md bg-background px-row py-inset text-xs font-medium shadow-sm">
            Liked songs
          </button>
          <button type="button" role="radio" aria-checked="false" className="rounded-md px-row py-inset text-xs font-medium text-muted-foreground">
            New playlist
          </button>
        </div>
      </div>
    );
  }
  if (destination === 'cards') {
    return (
      <div data-testid="transfer-destination" data-destination={destination} className="grid grid-cols-2 gap-row">
        <button type="button" aria-pressed="true" className="rounded-lg border border-ember bg-ember/10 p-row text-left">
          <div className="text-sm font-medium">Liked songs</div>
          <div className="mt-inset text-xs text-muted-foreground">These become your likes and shape your mixes.</div>
        </button>
        <button type="button" aria-pressed="false" className="rounded-lg border border-border p-row text-left">
          <div className="text-sm font-medium">A new playlist</div>
          <div className="mt-inset text-xs text-muted-foreground">A playlist you can edit and share.</div>
        </button>
      </div>
    );
  }
  return (
    <p data-testid="transfer-destination" data-destination={destination} className="text-sm text-muted-foreground">
      These become your <span className="font-medium text-foreground">Liked songs</span>.
      {entryImplied ? ` (${entryImplied})` : ''}
    </p>
  );
}

export interface TransferDialogProps {
  destination: TransferDestinationId;
  phone: boolean;
  sourceTab: SourceTab;
  onSourceTab: (t: SourceTab) => void;
  /** Lead content before the title, e.g. tabs for the "third tab" entry. */
  lead?: ReactNode;
  title?: string;
  /** One line explaining why the destination needs no control here. */
  entryImplied?: string;
  onStart: () => void;
}

/** The dialog itself: source step on top, destination step below it,
 *  Cancel/Start footer. `lead` lets the "third tab" entry candidate draw
 *  its own tab strip above this same body. */
export function TransferDialog({ destination, phone, sourceTab, onSourceTab, lead, title = 'Transfer songs', entryImplied, onStart }: TransferDialogProps) {
  return (
    <div className="absolute inset-0 z-40" data-testid="transfer-dialog">
      <div className="absolute inset-0 bg-black/10 backdrop-blur-xs" />
      <div
        role="dialog"
        aria-label={title}
        className={cn(
          'absolute top-1/2 left-1/2 flex max-h-[90%] w-full -translate-x-1/2 -translate-y-1/2 flex-col gap-block rounded-xl bg-popover p-block text-sm text-popover-foreground ring-1 ring-foreground/10',
          phone ? 'max-w-[calc(100%-2rem)]' : 'max-w-lg',
        )}
      >
        {lead}
        <div className="flex items-center gap-cluster pr-stack">
          <MusicIcon className="h-4 w-4 text-ember" />
          <div className="font-heading text-base leading-none font-medium">{title}</div>
        </div>
        <SourceTabs tab={sourceTab} onTab={onSourceTab} />
        <DestinationControl destination={destination} entryImplied={entryImplied} />
        <div className="-mx-block -mb-block flex justify-end gap-cluster rounded-b-xl border-t bg-muted/50 p-block">
          <Button variant="ghost">Cancel</Button>
          <Button onClick={onStart} className="bg-ember text-white hover:bg-ember-soft">
            Start
          </Button>
        </div>
        <Button variant="ghost" size="icon-sm" className="absolute top-2 right-2" aria-label="Close">
          <CloseIcon />
        </Button>
      </div>
    </div>
  );
}

export type { SourceTab };
export { SOURCE_TABS };
