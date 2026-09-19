'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CollectionHeader } from '@/components/page/CollectionHeader';
import { ActionBar } from '@/components/page/ActionBar';
import { PlayButton } from '@/components/primitives/PlayButton';
import { CollectionCover } from '@/components/primitives/CollectionCover';
import { Artwork } from '@/components/primitives/Artwork';
import { Eyebrow } from '@/components/page/Eyebrow';
import { TrackRow } from '@/components/track/TrackRow';
import { CloseIcon, MoreIcon, MusicIcon, ReviewIcon, SearchIcon, ShuffleIcon } from '@/components/icons';
import { formatTime, formatTotalDuration } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Track } from '@/types/track';
import {
  importArt,
  MOCK_IMPORT_ITEMS,
  MOCK_IMPORT_PROGRESS,
  type ImportCandidate,
  type ImportItem,
  type ImportSource,
} from '@/app/(app)/dizajn/mock';
import { CandidateRow, ProgressRing, SOURCE_NAME, StatusPill } from '@/components/library/options/imports/parts';

/** The import's counts after `resolved` picks: what the Done summary, the
 *  review screens and the sidebar row all show. */
export function importCounts(resolved: Record<string, string>) {
  const review = MOCK_IMPORT_ITEMS.filter((i) => i.status === 'review' && !resolved[i.id]).length;
  const notFound = MOCK_IMPORT_ITEMS.filter((i) => i.status === 'not-found').length;
  return { added: MOCK_IMPORT_ITEMS.length - review - notFound, review, notFound };
}

/** A source row as the Track the playlist ends up holding: the matched
 *  YouTube upload carries the Spotify title and artist. */
function asTrack(item: ImportItem, index: number, picked?: ImportCandidate): Track {
  return {
    id: `import:${item.id}`,
    source: 'youtube',
    sourceId: item.id,
    title: item.title,
    artist: item.artist,
    artistId: null,
    album: item.album,
    albumId: null,
    durationSec: picked?.durationSec ?? item.durationSec,
    artworkUrl: item.status === 'not-found' ? null : (picked?.artworkUrl ?? importArt(index)),
    streamUrl: '',
  };
}

/** TrackRow's phone layout (the 3-column grid it switches to below md),
 *  copied because the phone frame renders on a desktop-wide viewport where
 *  the real row would pick its 5-column desktop grid. */
export function PhoneTrackRow({ track, index, trailing, dim }: { track: Track; index: number; trailing?: ReactNode; dim?: boolean }) {
  return (
    <div
      className={cn(
        'group grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-row rounded-md px-row py-cluster transition-colors hover:bg-card',
        dim && 'opacity-60',
      )}
    >
      <div className="grid h-8 w-8 place-items-center justify-self-center text-sm tabular-nums text-muted-foreground">{index + 1}</div>
      <div className="flex min-w-0 items-center gap-row">
        <Artwork src={track.artworkUrl} size="xs" className="grid shrink-0 place-items-center rounded bg-black text-foreground/20">
          <MusicIcon className="h-4 w-4" />
        </Artwork>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{track.title}</div>
          <div className="truncate text-xs text-muted-foreground">{track.artist}</div>
        </div>
      </div>
      <div className="flex items-center gap-inset">{trailing}</div>
    </div>
  );
}

/** Desktop rows' trailing slot. A fixed width, so a status pill or the
 *  Pick button on one row does not push that row's album and length
 *  columns out of line with the rest (TrackRow's last column is auto). */
const TRAILING = 'flex w-40 items-center justify-end gap-cluster';

/** A source row that has not been matched yet: its Spotify title greyed,
 *  in the same grid as a real row so nothing jumps when it lands. */
function PendingRow({ item, index, phone, next }: { item: ImportItem; index: number; phone: boolean; next: boolean }) {
  return (
    <div
      data-testid="pending-row"
      className={cn(
        'grid items-center gap-row rounded-md px-row py-cluster',
        phone ? 'grid-cols-[40px_minmax(0,1fr)_auto]' : 'grid-cols-[40px_minmax(0,1fr)_minmax(0,1fr)_60px_auto]',
      )}
    >
      <div className="grid h-8 w-8 place-items-center justify-self-center text-sm tabular-nums text-muted-foreground/60">{index + 1}</div>
      <div className="flex min-w-0 items-center gap-row">
        <div className={cn('size-art-xs shrink-0 rounded bg-muted', next && 'animate-pulse')} />
        <div className="min-w-0 text-muted-foreground/70">
          <div className="truncate text-sm font-medium">{item.title}</div>
          <div className="truncate text-xs">{item.artist}</div>
        </div>
      </div>
      {!phone && <div className="truncate text-sm text-muted-foreground/60">{item.album}</div>}
      {!phone && <div className="text-right text-sm tabular-nums text-muted-foreground/60">{formatTime(item.durationSec)}</div>}
      <div className={cn('whitespace-nowrap text-[11px] text-muted-foreground', !phone && TRAILING)}>{next ? 'Matching…' : 'Waiting'}</div>
    </div>
  );
}

/** The phone header: CollectionHeader's stacked (below md) layout. */
export function PhoneHeader({
  title,
  meta,
  cover,
  actions,
}: {
  title: string;
  meta: string[];
  cover: { src: string | null; icon: 'heart' | null };
  actions: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-stack">
      <div className="size-art-hero shrink-0 rounded-2xl">
        <CollectionCover {...cover} className="h-full w-full rounded-2xl" />
      </div>
      <div>
        <Eyebrow>Playlist</Eyebrow>
        <h1 className="mt-cluster text-4xl font-bold leading-tight tracking-tight">{title}</h1>
        <div className="mt-cluster text-meta">{meta.join(' · ')}</div>
        <div className="mt-stack">{actions}</div>
      </div>
    </div>
  );
}

export function Actions() {
  return (
    <ActionBar>
      <PlayButton />
      <Button variant="ghost" size="icon" className="h-12 w-12 rounded-full text-muted-foreground" aria-label="Shuffle play">
        <ShuffleIcon className="h-5 w-5" />
      </Button>
      <Button variant="ghost" size="icon" className="h-12 w-12 rounded-full text-muted-foreground" aria-label="More">
        <MoreIcon className="h-5 w-5" />
      </Button>
    </ActionBar>
  );
}

/** The slim banner while the import runs: ring, count, a hairline bar. */
function ProgressBanner({ source, phone }: { source: ImportSource; phone: boolean }) {
  const { done, total } = MOCK_IMPORT_PROGRESS;
  return (
    <div data-testid="import-progress-banner" className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center gap-row px-block py-row">
        <ProgressRing done={done} total={total} size={18} />
        <div className="min-w-0 flex-1 text-sm">
          <span className="font-medium">
            Importing from {SOURCE_NAME[source.kind]}, {done} of {total}
          </span>
          {!phone && <span className="text-muted-foreground"> · You can leave this page, it keeps going.</span>}
        </div>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          Stop
        </Button>
      </div>
      <div className="h-0.5 bg-muted">
        <div className="h-full bg-ember" style={{ width: `${(done / total) * 100}%` }} />
      </div>
    </div>
  );
}

/** The Done summary: counts and the Review button. */
function DoneSummary({ phone, resolved, onReview }: { phone: boolean; resolved: Record<string, string>; onReview: () => void }) {
  const c = importCounts(resolved);
  const stats: { n: number; label: string; tone: string }[] = [
    { n: c.added, label: 'added', tone: 'text-foreground' },
    { n: c.review, label: 'need review', tone: 'text-ember' },
    { n: c.notFound, label: 'not found', tone: 'text-muted-foreground' },
  ];
  return (
    <div
      data-testid="import-summary"
      className={cn(
        'flex gap-row rounded-lg border border-border bg-card px-block py-row',
        phone ? 'flex-col items-stretch' : 'items-center',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">Import finished</div>
        <div className="mt-inset flex flex-wrap gap-x-block gap-y-inset text-sm">
          {stats.map((s) => (
            <span key={s.label} className="tabular-nums">
              <span className={cn('font-semibold', s.tone)}>{s.n}</span> <span className="text-muted-foreground">{s.label}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-cluster">
        <Button onClick={onReview} className={cn('bg-ember text-white hover:bg-ember-soft', phone && 'flex-1')} disabled={c.review === 0}>
          <ReviewIcon className="h-4 w-4" />
          Review
        </Button>
        <Button variant="ghost" size="icon" aria-label="Dismiss" className="text-muted-foreground">
          <CloseIcon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/** Inline review's popover: the candidates for one row, a search box for
 *  anything else, and a way out. Anchored under its row. */
export function CandidatesPopover({
  item,
  phone,
  onPick,
  onClose,
}: {
  item: ImportItem;
  phone: boolean;
  onPick: (candidateId: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      data-testid="candidates-popover"
      role="dialog"
      aria-label={`Pick a match for ${item.title}`}
      className={cn(
        'absolute top-full z-20 mt-inset flex flex-col rounded-xl bg-popover text-popover-foreground shadow-soft ring-1 ring-foreground/10',
        phone ? 'inset-x-0' : 'right-0 w-[30rem]',
      )}
    >
      <div className="flex items-start gap-row border-b border-border px-block py-row">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {item.title} <span className="font-normal text-muted-foreground">· {item.artist}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            On Spotify: {formatTime(item.durationSec)} · {item.flag}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose} className="-mr-cluster -mt-inset">
          <CloseIcon />
        </Button>
      </div>
      <div className="flex max-h-80 flex-col gap-inset overflow-y-auto p-cluster">
        {item.candidates?.map((c, i) => (
          <CandidateRow key={c.id} candidate={c} best={i === 0} onPick={() => onPick(c.id)} />
        ))}
      </div>
      <div className="flex items-center gap-cluster border-t border-border px-block py-row">
        <div className="relative min-w-0 flex-1">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search YouTube for another version" className="h-8 pl-9" readOnly />
        </div>
        {!phone && (
          <Button variant="ghost" size="sm" className="text-muted-foreground">
            Remove song
          </Button>
        )}
      </div>
    </div>
  );
}

export interface ImportPlaylistPageProps {
  phone: boolean;
  source: ImportSource;
  /** importing: rows land up to MOCK_IMPORT_PROGRESS.done. done: all in. */
  phase: 'importing' | 'done';
  /** Candidate id picked per review item (the review screens fill this). */
  resolved: Record<string, string>;
  /** Inline review: flagged rows get a Pick button. */
  inlineReview: boolean;
  /** Inline review: the row whose popover is open. */
  openItemId: string | null;
  onOpenItem: (id: string | null) => void;
  onPick: (itemId: string, candidateId: string) => void;
  onReview: () => void;
}

/** The new playlist's page while it fills in and once it is done: the real
 *  CollectionHeader and TrackRow on desktop, phone-shaped copies in the
 *  phone frame (both pick layout by viewport width, and the gallery's
 *  phone frame sits on a desktop-wide viewport). */
export function ImportPlaylistPage({
  phone,
  source,
  phase,
  resolved,
  inlineReview,
  openItemId,
  onOpenItem,
  onPick,
  onReview,
}: ImportPlaylistPageProps) {
  const landed = phase === 'done' ? MOCK_IMPORT_ITEMS.length : MOCK_IMPORT_PROGRESS.done;
  // Inline review: bring the open row near the top of the frame's own
  // scroller so its popover fits underneath. Only that scroller moves,
  // never the gallery page (scrollIntoView would scroll every ancestor).
  const openRowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = openRowRef.current;
    if (!inlineReview || !row) return;
    const scroller = row.closest<HTMLElement>('.overflow-y-auto');
    if (!scroller) return;
    const top = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    const scale = scroller.getBoundingClientRect().height / (scroller.clientHeight || 1);
    scroller.scrollTop += top / (scale || 1) - 96;
  }, [inlineReview, openItemId]);
  const counts = importCounts(resolved);
  const totalSec = MOCK_IMPORT_ITEMS.slice(0, landed)
    .filter((i) => i.status !== 'not-found')
    .reduce((s, i) => s + i.durationSec, 0);
  const meta =
    phase === 'importing'
      ? [`From ${SOURCE_NAME[source.kind]}`, `${landed} of ${MOCK_IMPORT_ITEMS.length} songs`]
      : [`From ${SOURCE_NAME[source.kind]}`, `${counts.added + counts.review} songs`, formatTotalDuration(totalSec)];

  const header = phone ? (
    <PhoneHeader title={source.name} meta={meta} cover={{ src: source.cover, icon: null }} actions={<Actions />} />
  ) : (
    <CollectionHeader eyebrow="Playlist" title={source.name} meta={meta} cover={{ src: source.cover, icon: null }}>
      <Actions />
    </CollectionHeader>
  );

  return (
    <div data-testid="import-playlist-page" data-phase={phase}>
      <div className="flex flex-col gap-stack">
        {header}
        {phase === 'importing' ? (
          <ProgressBanner source={source} phone={phone} />
        ) : (
          <DoneSummary phone={phone} resolved={resolved} onReview={onReview} />
        )}
        <div className="flex flex-col">
          {MOCK_IMPORT_ITEMS.map((item, i) => {
            if (i >= landed) return <PendingRow key={item.id} item={item} index={i} phone={phone} next={i === landed} />;
            const picked = item.candidates?.find((c) => c.id === resolved[item.id]);
            const flagged = item.status === 'review' && !picked;
            const track = asTrack(item, i, picked);
            const pick =
              flagged && inlineReview ? (
                <Button
                  size="sm"
                  variant="outline"
                  aria-expanded={openItemId === item.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenItem(openItemId === item.id ? null : item.id);
                  }}
                  className="border-ember/50 text-ember hover:text-ember"
                >
                  Pick
                </Button>
              ) : null;
            const status =
              item.status === 'not-found' ? (
                <StatusPill status="not-found" />
              ) : flagged ? (
                <>
                  {!(phone && pick) && <StatusPill status="review" />}
                  {pick}
                </>
              ) : null;
            const trailing = phone ? status ?? undefined : <div className={TRAILING}>{status}</div>;
            const row = phone ? (
              <PhoneTrackRow track={track} index={i} trailing={trailing} dim={item.status === 'not-found'} />
            ) : (
              <TrackRow
                track={track}
                index={i}
                showRank
                artworkFallback={<MusicIcon className="h-4 w-4" />}
                trailing={trailing}
                onPlay={() => {}}
                className={cn(item.status === 'not-found' && 'opacity-60', flagged && 'bg-ember/5')}
              />
            );
            return (
              <div
                key={item.id}
                ref={openItemId === item.id ? openRowRef : undefined}
                className={cn('relative', openItemId === item.id && 'z-20')}
                data-testid={`import-row-${item.status}`}
              >
                  {row}
                  {inlineReview && openItemId === item.id && item.candidates && (
                    <CandidatesPopover
                      item={item}
                      phone={phone}
                      onPick={(cid) => onPick(item.id, cid)}
                      onClose={() => onOpenItem(null)}
                    />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

