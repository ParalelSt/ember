'use client';

import { useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Artwork } from '@/components/primitives/Artwork';
import { AlertIcon, CheckIcon, ChevronLeftIcon, CloseIcon, SearchIcon, TrashIcon } from '@/components/icons';
import { formatTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { MOCK_IMPORT_ITEMS, type ImportItem, type ImportSource } from '@/app/(app)/dizajn/mock';
import { CandidateRow, Kbd, SOURCE_NAME, SourceBadge } from '@/components/library/options/imports/parts';

/** The songs the matcher was unsure of, in playlist order. */
export const REVIEW_ITEMS = MOCK_IMPORT_ITEMS.filter((i) => i.status === 'review');
const NOT_FOUND_ITEMS = MOCK_IMPORT_ITEMS.filter((i) => i.status === 'not-found');

/** How many candidates the sheet shows up front: one per number key. */
export const SHEET_KEYS = 3;

/** The source song as Spotify has it: what every candidate is judged
 *  against. */
function SourceCard({ item, source, compact }: { item: ImportItem; source: ImportSource; compact?: boolean }) {
  const pos = MOCK_IMPORT_ITEMS.indexOf(item) + 1;
  return (
    <div className={cn('rounded-lg border border-border bg-card', compact ? 'p-row' : 'p-block')}>
      <div className="flex items-center justify-between gap-cluster">
        <div className="text-eyebrow">On {SOURCE_NAME[source.kind]}</div>
        <div className="text-xs tabular-nums text-muted-foreground">#{pos}</div>
      </div>
      <div className={cn('truncate font-bold tracking-tight', compact ? 'mt-inset text-base' : 'mt-cluster text-lg')}>{item.title}</div>
      <div className="truncate text-meta">
        {item.artist} · {item.album} · {formatTime(item.durationSec)}
      </div>
      {item.flag && (
        <div className="mt-cluster flex items-center gap-cluster text-xs text-ember">
          <AlertIcon className="h-3.5 w-3.5 shrink-0" />
          {item.flag}
        </div>
      )}
    </div>
  );
}

export interface ReviewSheetProps {
  phone: boolean;
  source: ImportSource;
  /** Position in REVIEW_ITEMS; past the end is the "all done" state. */
  index: number;
  /** Candidates past the first three are shown. */
  showAll: boolean;
  onShowAll: () => void;
  onPick: (itemId: string, candidateId: string) => void;
  onSkip: () => void;
  onClose: () => void;
}

/** Side sheet review: one uncertain song at a time, source on top,
 *  candidates below with number keys, Skip. A bottom sheet on phone. The
 *  keys themselves are handled by the section (one listener for both
 *  frames). */
export function ReviewSheet({ phone, source, index, showAll, onShowAll, onPick, onSkip, onClose }: ReviewSheetProps) {
  const item = REVIEW_ITEMS[index];
  const shown = item?.candidates?.slice(0, showAll ? undefined : SHEET_KEYS) ?? [];
  const hidden = (item?.candidates?.length ?? 0) - shown.length;
  return (
    <div className="absolute inset-0 z-20" data-testid="review-sheet">
      <button type="button" aria-label="Close review" onClick={onClose} className="absolute inset-0 bg-black/20" />
      <div
        role="dialog"
        aria-label="Review matches"
        className={cn(
          'absolute flex flex-col bg-popover text-popover-foreground shadow-soft ring-1 ring-foreground/10 animate-in duration-200',
          phone
            ? 'inset-x-0 bottom-0 max-h-[88%] rounded-t-2xl slide-in-from-bottom-8'
            : 'inset-y-0 right-0 w-[26rem] slide-in-from-right-8',
        )}
      >
        {phone && <div className="mx-auto mt-cluster h-1 w-10 shrink-0 rounded-full bg-muted" />}
        <div className="flex items-center gap-row border-b border-border px-block py-row">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Review matches</div>
            <div className="text-xs text-muted-foreground">
              {item ? `${index + 1} of ${REVIEW_ITEMS.length}` : 'All done'} · {source.name}
            </div>
          </div>
          <div className="flex gap-inset" aria-hidden>
            {REVIEW_ITEMS.map((r, i) => (
              <span key={r.id} className={cn('h-1.5 w-5 rounded-full', i < index ? 'bg-ember' : i === index ? 'bg-foreground/70' : 'bg-muted')} />
            ))}
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </Button>
        </div>

        {item ? (
          <>
            <div className="flex min-h-0 flex-1 flex-col gap-block overflow-y-auto p-block">
              <SourceCard item={item} source={source} compact={phone} />
              <div>
                <div className="mb-cluster text-eyebrow">Pick the right one</div>
                <div className="-mx-cluster flex flex-col gap-inset">
                  {shown.map((c, i) => (
                    <CandidateRow
                      key={c.id}
                      candidate={c}
                      best={i === 0}
                      keyHint={phone || i >= SHEET_KEYS ? undefined : String(i + 1)}
                      onPick={() => onPick(item.id, c.id)}
                    />
                  ))}
                </div>
                {hidden > 0 && (
                  <button type="button" onClick={onShowAll} className="mt-cluster text-xs font-medium text-muted-foreground hover:text-foreground">
                    Show {hidden} more
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-cluster">
                <Button variant="outline" size="sm">
                  <SearchIcon className="h-3.5 w-3.5" />
                  Search YouTube
                </Button>
                <Button variant="ghost" size="sm" className="text-muted-foreground">
                  <TrashIcon className="h-3.5 w-3.5" />
                  Remove song
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-cluster border-t border-border bg-muted/40 px-block py-row">
              {!phone && (
                <div className="flex min-w-0 flex-1 items-center gap-inset text-xs text-muted-foreground">
                  <Kbd>1</Kbd>
                  <Kbd>2</Kbd>
                  <Kbd>3</Kbd>
                  <span className="ml-inset">to pick</span>
                </div>
              )}
              <Button variant="ghost" onClick={onSkip} className={cn(phone && 'flex-1')}>
                Skip {!phone && <Kbd>S</Kbd>}
              </Button>
              <Button onClick={() => onPick(item.id, item.candidates![0].id)} className={cn('bg-ember text-white hover:bg-ember-soft', phone && 'flex-1')}>
                Use best match
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-cluster p-stack text-center">
            <span className="grid size-11 place-items-center rounded-full bg-ember/15 text-ember">
              <CheckIcon className="h-5 w-5" />
            </span>
            <div className="text-base font-semibold">All reviewed</div>
            <div className="text-meta">Skipped songs stay marked in the playlist so you can come back to them.</div>
            <Button variant="outline" size="sm" className="mt-cluster" onClick={onClose}>
              Back to the playlist
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export interface ReviewPageProps {
  phone: boolean;
  source: ImportSource;
  /** Chosen candidate per review item; missing means the best one. */
  choices: Record<string, string>;
  /** Items already accepted (their card collapses to one line). */
  resolved: Record<string, string>;
  onChoose: (itemId: string, candidateId: string) => void;
  onAccept: (itemId: string) => void;
  onAcceptAll: () => void;
}

/** Review page: the whole queue at once. Each uncertain song has its best
 *  candidate already chosen, so "Accept all" finishes the common case in
 *  one click; not-found songs sit underneath. */
export function ReviewPage({ phone, source, choices, resolved, onChoose, onAccept, onAcceptAll }: ReviewPageProps) {
  const open = REVIEW_ITEMS.filter((i) => !resolved[i.id]);
  // A page of its own: start at the top of the frame's scroller, not
  // wherever the playlist page behind it was left.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = ref.current?.closest<HTMLElement>('.overflow-y-auto');
    if (scroller) scroller.scrollTop = 0;
  }, []);
  return (
    <div data-testid="review-page" ref={ref}>
      <button type="button" className="mb-block flex items-center gap-inset text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeftIcon className="h-4 w-4" />
        {source.name}
      </button>
      <div className={cn('flex gap-block', phone ? 'flex-col' : 'items-end justify-between')}>
        <div>
          <h1 className={cn('font-bold tracking-tight', phone ? 'text-3xl' : 'text-4xl')}>Review matches</h1>
          <div className="mt-cluster flex flex-wrap items-center gap-cluster text-meta">
            <SourceBadge kind={source.kind} />
            {open.length} {open.length === 1 ? 'song needs' : 'songs need'} a look · {NOT_FOUND_ITEMS.length} not found
          </div>
        </div>
        <Button
          onClick={onAcceptAll}
          disabled={open.length === 0}
          className={cn('bg-ember text-white hover:bg-ember-soft', phone && 'w-full')}
        >
          <CheckIcon className="h-4 w-4" />
          Accept all ({open.length})
        </Button>
      </div>
      {!phone && (
        <p className="mt-cluster text-xs text-muted-foreground">
          Each song already has its best match chosen. Change any you disagree with, then accept.
        </p>
      )}

      <div className="mt-stack flex flex-col gap-row">
        {REVIEW_ITEMS.map((item) => {
          const done = resolved[item.id];
          const chosen = choices[item.id] ?? item.candidates![0].id;
          if (done) {
            const c = item.candidates!.find((x) => x.id === done)!;
            return (
              <div key={item.id} data-testid="review-card-done" className="flex items-center gap-row rounded-lg border border-border px-block py-row text-sm">
                <CheckIcon className="h-4 w-4 shrink-0 text-ember" />
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{item.title}</span>
                  <span className="text-muted-foreground"> · {c.title}</span>
                </span>
                <span className="text-xs text-muted-foreground">Added</span>
              </div>
            );
          }
          return (
            <div
              key={item.id}
              data-testid="review-card"
              className={cn('grid gap-block rounded-xl border border-border bg-card/40 p-block', phone ? 'grid-cols-1' : 'grid-cols-[14rem_minmax(0,1fr)]')}
            >
              <div className="min-w-0">
                <div className="text-eyebrow">#{MOCK_IMPORT_ITEMS.indexOf(item) + 1}</div>
                <div className="mt-inset truncate text-base font-bold tracking-tight">{item.title}</div>
                <div className="truncate text-meta">{item.artist}</div>
                <div className="text-xs tabular-nums text-muted-foreground">{formatTime(item.durationSec)} on {SOURCE_NAME[source.kind]}</div>
                <div className="mt-cluster flex items-start gap-cluster text-xs text-ember">
                  <AlertIcon className="h-3.5 w-3.5 shrink-0 translate-y-px" />
                  {item.flag}
                </div>
                {!phone && (
                  <Button size="sm" variant="outline" className="mt-block" onClick={() => onAccept(item.id)}>
                    Accept
                  </Button>
                )}
              </div>
              <div className="flex min-w-0 flex-col gap-inset">
                {item.candidates!.map((c, i) => (
                  <CandidateRow key={c.id} candidate={c} best={i === 0} selected={c.id === chosen} onPick={() => onChoose(item.id, c.id)} />
                ))}
              </div>
              {phone && (
                <Button size="sm" variant="outline" onClick={() => onAccept(item.id)}>
                  Accept
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <h2 className="mt-section mb-row text-section-title">Not found</h2>
      <div className="flex flex-col gap-cluster">
        {NOT_FOUND_ITEMS.map((item) => (
          <div key={item.id} data-testid="review-not-found" className={cn('flex gap-row rounded-lg border border-border px-block py-row', phone ? 'flex-col' : 'items-center')}>
            <div className="flex min-w-0 flex-1 items-center gap-row">
              <Artwork size="xs" className="shrink-0 rounded bg-muted" />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{item.title}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {item.artist} · Nothing on YouTube is close enough
                </div>
              </div>
            </div>
            <div className="flex gap-cluster">
              <Button size="sm" variant="outline">
                <SearchIcon className="h-3.5 w-3.5" />
                Search YouTube
              </Button>
              <Button size="sm" variant="ghost" className="text-muted-foreground">
                Remove
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
