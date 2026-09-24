import type { ReactNode } from 'react';
import { TrackRow } from '@/components/track/TrackRow';
import type { TrackActions } from '@/components/track/TrackList';
import { Artwork } from '@/components/primitives/Artwork';
import { MusicIcon } from '@/components/icons';
import { StatusPill } from '@/components/import/parts';
import { formatTime } from '@/lib/format';
import { songKey } from '@/lib/songKey';
import type { ImportRow } from '@/lib/import/rows';
import type { ImportItem } from '@/lib/import/types';
import type { PlaybackContext, Track } from '@/types/track';
import { cn } from '@/lib/utils';

// Every row shares the list's column tracks (CSS subgrid), so a status pill
// on one row never pushes that row's album and length columns out of line
// with the tracks around it.
const LIST = 'grid grid-cols-[40px_minmax(0,1fr)_auto] md:grid-cols-[40px_minmax(0,1fr)_minmax(0,1fr)_60px_auto]';
const ROW = 'col-span-full grid-cols-subgrid md:grid-cols-subgrid';

interface Props extends TrackActions {
  rows: ImportRow[];
  context?: PlaybackContext | null;
  trailing?: (track: Track) => ReactNode;
  onRemove?: (trackId: string) => void;
  onReplace?: (track: Track) => void;
  /** Opens the review sheet at this song. */
  onOpenItem: (item: ImportItem) => void;
}

/** A source song that is not a playlist track (yet): still being matched,
 *  waiting for a look, or not found. Laid out like a TrackRow. */
function PlaceholderRow({
  item,
  index,
  kind,
  next,
  onOpen,
}: {
  item: ImportItem;
  index: number;
  kind: 'pending' | 'review' | 'missing';
  next?: boolean;
  onOpen: () => void;
}) {
  const pending = kind === 'pending';
  const art = kind === 'review' ? (item.candidates[0]?.track.artworkUrl ?? null) : null;
  const body = (
    <>
      <div className="grid h-8 w-8 place-items-center justify-self-center text-sm tabular-nums text-muted-foreground/70">{index + 1}</div>
      <div className="flex min-w-0 items-center gap-row">
        {pending ? (
          <div className={cn('size-art-xs shrink-0 rounded bg-muted', next && 'animate-pulse')} />
        ) : (
          <Artwork src={art} size="xs" className="grid shrink-0 place-items-center rounded bg-art text-foreground/20">
            <MusicIcon className="h-4 w-4" />
          </Artwork>
        )}
        <div className={cn('min-w-0 text-left', pending && 'text-muted-foreground/70')}>
          <div className={cn('truncate text-sm', pending ? 'font-medium' : 'font-semibold')}>{item.source.title}</div>
          <div className={cn('truncate text-xs', !pending && 'text-muted-foreground')}>{item.source.artist}</div>
        </div>
      </div>
      <div className="hidden truncate text-sm text-muted-foreground/60 md:block" />
      <div className="hidden text-right text-sm tabular-nums text-muted-foreground md:block">
        {formatTime(item.source.durationMs ? item.source.durationMs / 1000 : null, { empty: '--:--' })}
      </div>
      <div className="flex items-center justify-end gap-inset">
        {pending ? (
          <span className="whitespace-nowrap text-[11px] text-muted-foreground">{next ? 'Matching…' : 'Waiting'}</span>
        ) : (
          <StatusPill status={kind === 'review' ? 'review' : 'not-found'} />
        )}
      </div>
    </>
  );
  const className = cn(ROW, 'grid items-center gap-row rounded-md px-row py-cluster');
  if (pending) {
    return (
      <div data-testid="pending-row" className={className}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      data-testid={`import-row-${kind}`}
      data-position={item.position}
      onClick={onOpen}
      aria-label={`${kind === 'review' ? 'Review' : 'Find'} "${item.source.title}"`}
      className={cn(className, 'text-left transition-colors hover:bg-card', kind === 'review' ? 'bg-ember/5' : 'opacity-60')}
    >
      {body}
    </button>
  );
}

/** Presentational only: a playlist's rows while its import is shown, the
 *  real tracks (as TrackList draws them) with the import's placeholders in
 *  source order. */
export function ImportTrackList({
  rows,
  context,
  trailing,
  onRemove,
  onReplace,
  onOpenItem,
  currentId,
  isPlaying,
  likedIds,
  onPlay,
  onToggle,
  onLike,
  isUnavailable,
  artworkSrcFor,
}: Props) {
  const tracks = rows.flatMap((r) => (r.kind === 'track' ? [r.track] : []));
  return (
    <div data-testid="import-track-list" className={LIST}>
      {rows.map((r, i) => {
        if (r.kind !== 'track') {
          return (
            <PlaceholderRow
              key={r.key}
              item={r.item}
              index={i}
              kind={r.kind}
              next={r.kind === 'pending' ? r.next : undefined}
              onOpen={() => onOpenItem(r.item)}
            />
          );
        }
        const t = r.track;
        const unavailable = !!isUnavailable?.(t);
        return (
          <TrackRow
            key={r.key}
            track={t}
            index={i}
            showRank
            active={currentId === t.id}
            playing={isPlaying}
            liked={onLike ? likedIds.has(t.id) || likedIds.has(songKey(t)) : undefined}
            artworkSrc={artworkSrcFor?.(t) ?? undefined}
            artworkFallback={<MusicIcon className="h-4 w-4" />}
            onPlay={() => onPlay(t, tracks, context)}
            onToggle={onToggle}
            onLike={onLike ? () => onLike(t) : undefined}
            onRemove={onRemove ? () => onRemove(t.id) : undefined}
            trailing={trailing?.(t)}
            unavailable={unavailable}
            onReplace={unavailable && onReplace ? () => onReplace(t) : undefined}
            className={ROW}
          />
        );
      })}
    </div>
  );
}
