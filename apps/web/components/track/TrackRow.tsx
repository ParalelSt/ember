'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Artwork } from '@/components/primitives/Artwork';
import { LikeButton } from '@/components/primitives/LikeButton';
import { CloseIcon, PauseIcon, PlayIcon, RefreshIcon, TrashIcon } from '@/components/icons';
import { formatTime } from '@/lib/format';
import type { Track } from '@/types/track';
import { cn } from '@/lib/utils';

export type TrackRowDensity = 'list' | 'compact';
/** Which palette the row sits in. The queue sheet paints its own sidebar
 *  colours, so its secondary text is not `muted-foreground`. */
export type TrackRowTone = 'default' | 'sidebar';

const SUBTLE: Record<TrackRowTone, string> = {
  default: 'text-muted-foreground',
  sidebar: 'text-sidebar-foreground/55',
};

/** Words for `unavailableReason` codes, shown as the badge's `title`
 *  tooltip so a listener can see why without opening the replace dialog. */
function reasonLabel(reason: string | null | undefined): string {
  switch (reason) {
    case 'removed': return 'Removed from YouTube';
    case 'private': return 'Made private';
    case 'geo': return 'Blocked in this country';
    case 'members': return 'Members only';
    case 'terminated': return 'Channel closed';
    default: return 'Not available';
  }
}

export interface TrackRowProps {
  track: Track;
  /** 0-based position; rendered as `index + 1` when `showRank`. */
  index?: number;
  showRank?: boolean;
  showAlbum?: boolean;
  showDuration?: boolean;
  /** This row's track is the player's current one. */
  active?: boolean;
  /** The player is playing: only meaningful together with `active`. */
  playing?: boolean;
  /** Omit to hide the heart entirely (queue, search recents, picker). */
  liked?: boolean;
  /** Start this track. Omitting it makes the row inert (the queue sheet's
   *  "Now playing" row, which is a label rather than a control). */
  onPlay?: () => void;
  /** Play/pause the current track: used by the leading cell when `active`. */
  onToggle?: () => void;
  onLike?: () => void;
  onRemove?: () => void;
  /** aria-label for the remove button; search recents names the track. */
  removeLabel?: string;
  /** Extra controls before the heart (the add-to-playlist / share menu). */
  trailing?: ReactNode;
  /** The server has confirmed this track can no longer be streamed. Greys
   *  the row, badges the title, disables its play cell, and turns a click
   *  into an explanation instead of silent nothing. `list` density only:
   *  compact rows (queue sheet, recents, picker) are unchanged. */
  unavailable?: boolean;
  /** Opens the find-replacement flow. Only rendered on an unavailable row,
   *  and only where a replacement is actionable (a playlist, or Liked). */
  onReplace?: () => void;
  /** Rendered inside the artwork box when the track has no art. Omit and a
   *  track without art gets no box at all, which is what the list rows and
   *  the picker have always done. */
  artworkFallback?: ReactNode;
  /** Overrides `track.artworkUrl` for the artwork image when given (a local
   *  downloaded-file URL, for offline rows). Undefined falls back to the
   *  track's own `artworkUrl`; null renders as no art. */
  artworkSrc?: string | null;
  /** The search overlay's row shape. The play/pause control moves to the
   *  trailing end of the row (revealed on hover or keyboard focus, always
   *  shown on the current row, always shown on a phone, which has neither),
   *  the `list` density drops its leading play column with it, and the
   *  current row is marked by its TITLE in the ember accent rather than the
   *  whole line. Default off, so every other caller keeps the leading play
   *  cell and the whole-row tint it has always had. */
  trailingPlayControl?: boolean;
  density?: TrackRowDensity;
  tone?: TrackRowTone;
  className?: string;
}

/** Presentational only: one track line. `list` is the full row used on
 *  collection, album, artist and search pages; `compact` is the tighter
 *  line used in the queue sheet, search recents and the track picker. */
export function TrackRow({
  track,
  index = 0,
  showRank = false,
  showAlbum = true,
  showDuration,
  active = false,
  playing = false,
  liked,
  onPlay,
  onToggle,
  onLike,
  onRemove,
  removeLabel = 'Remove',
  trailing,
  unavailable = false,
  onReplace,
  artworkFallback,
  artworkSrc,
  trailingPlayControl = false,
  density = 'list',
  tone = 'default',
  className,
}: TrackRowProps) {
  const compact = density === 'compact';
  const showTime = showDuration ?? !compact;
  // An unavailable track can't actually start (the server has confirmed
  // yt-dlp can't fetch it), so clicking it explains why instead of
  // silently doing nothing.
  const playOrToast = onPlay
    ? () => {
        if (unavailable) {
          toast.message(`"${track.title}" is unavailable on YouTube`);
          return;
        }
        onPlay();
      }
    : undefined;
  const duration = formatTime(track.durationSec, { empty: '--:--' });
  // `artworkSrc` (a downloaded file's local URL) wins when given; undefined
  // means "no override" and falls back to the track's own remote URL.
  const resolvedArtworkUrl = artworkSrc !== undefined ? artworkSrc : track.artworkUrl;
  const hasArtwork = !!resolvedArtworkUrl || artworkFallback !== undefined;

  const artwork = hasArtwork ? (
    <Artwork
      src={resolvedArtworkUrl}
      size="xs"
      onClick={compact ? undefined : playOrToast}
      className={cn(
        'rounded shrink-0 bg-art',
        !resolvedArtworkUrl && 'grid place-items-center text-foreground/20',
      )}
    >
      {artworkFallback}
    </Artwork>
  ) : null;

  const remove = onRemove ? (
    <Button
      variant="ghost"
      size="icon"
      className={cn(
        'text-muted-foreground hover:text-foreground',
        compact
          ? 'h-7 w-7 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 max-md:opacity-100 transition-opacity'
          : 'h-8 w-8',
      )}
      // Compact rows play on a single click, so the remove press must not
      // reach the row underneath.
      onClick={(e) => { e.stopPropagation(); onRemove(); }}
      aria-label={removeLabel}
    >
      {compact ? <CloseIcon className="h-3.5 w-3.5" /> : <TrashIcon className="h-3.5 w-3.5" />}
    </Button>
  ) : null;

  const like = liked !== undefined && onLike ? <LikeButton liked={liked} onToggle={onLike} /> : null;

  const replace = unavailable && onReplace ? (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 text-ember hover:text-ember"
      onClick={(e) => { e.stopPropagation(); onReplace(); }}
      aria-label="Find replacement"
      title="Find replacement"
    >
      <RefreshIcon className="h-3.5 w-3.5" />
    </Button>
  ) : null;

  // The search overlay's control. Hidden with opacity rather than removed,
  // so the space it takes is already reserved and nothing shifts when a
  // hover reveals it; opacity-0 still leaves it clickable and in the tab
  // order, which is what makes keyboard focus able to reveal it at all.
  // `size-hit md:size-8` is the app's touch convention (40px phone / 32px
  // desktop, docs/design-system.md section 2); 40px is also the xs artwork
  // height, so a compact row keeps its height on a phone.
  const playControl = trailingPlayControl ? (
    <Button
      variant="ghost"
      size="icon"
      data-testid="track-row-play"
      className={cn(
        'size-hit md:size-8 transition-opacity',
        active
          ? 'text-ember hover:text-ember'
          : 'text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 max-md:opacity-100',
      )}
      onClick={(e) => {
        e.stopPropagation();
        if (active) onToggle?.();
        else playOrToast?.();
      }}
      disabled={unavailable}
      aria-label={
        unavailable
          ? `"${track.title}" is unavailable`
          : active
            ? playing
              ? `Pause ${track.title}`
              : `Resume ${track.title}`
            : `Play ${track.title}`
      }
    >
      {active && playing ? <PauseIcon className="h-3.5 w-3.5" /> : <PlayIcon className="h-3.5 w-3.5" />}
    </Button>
  ) : null;

  /** The current row's mark when `trailingPlayControl` is on: the title in
   *  the ember accent, in both the playing and the paused state, and no
   *  glyph beside it. The button's own icon is the only thing that says
   *  which of the two it is. */
  const emberTitle = trailingPlayControl && active && 'text-ember';

  if (compact) {
    return (
      <div
        onClick={onPlay}
        className={cn(
          'group flex items-center gap-3 px-3 py-2 rounded-md transition-colors',
          onPlay && 'cursor-pointer hover:bg-card',
          active && !trailingPlayControl && 'text-ember',
          className,
        )}
      >
        {artwork}
        <div className="min-w-0 flex-1">
          <div data-testid="track-row-title" className={cn('truncate text-sm font-medium', emberTitle)}>
            {track.title}
          </div>
          {/* Plain text, not a link: these rows sit inside a sheet, a
              recents list and a picker, where a stray navigation would
              throw away what the user was doing. */}
          <div className={cn('truncate text-xs', SUBTLE[tone])}>{track.artist}</div>
        </div>
        {showTime && <div className={cn('text-xs tabular-nums', SUBTLE[tone])}>{duration}</div>}
        {playControl}
        {trailing}
        {like}
        {remove}
      </div>
    );
  }

  return (
    <div
      data-testid="track-row"
      data-unavailable={unavailable ? 'true' : undefined}
      onDoubleClick={playOrToast}
      className={cn(
        // The 5-column desktop shape (adds the album + duration columns)
        // only kicks in once the row's own container is wide enough, not
        // once the *window* is: a viewport breakpoint (md:) would still
        // pick the desktop shape inside a narrow container on a wide
        // window (the search overlay caps at max-w-xl, ~576px, well past
        // sm:768px on any laptop or desktop display), squeezing title and
        // album into equal, too-narrow halves. @3xl is 48rem/768px on the
        // container-query scale, the same number the old md: breakpoint
        // used, just measured against the row's own space. Below it, the
        // 3-column "phone" shape (this one, unqualified) is used, same as
        // it always was on a narrow phone screen.
        'group grid gap-3 items-center px-3 py-2 rounded-md cursor-pointer hover:bg-card transition-colors',
        // `trailingPlayControl` moves the control to the far end, so the
        // leading 40px column goes with it and the title starts at the
        // row's edge.
        trailingPlayControl
          ? 'grid-cols-[minmax(0,1fr)_auto] @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_60px_auto]'
          : 'grid-cols-[40px_minmax(0,1fr)_auto] @3xl:grid-cols-[40px_minmax(0,1fr)_minmax(0,1fr)_60px_auto]',
        active && !trailingPlayControl && 'text-ember',
        unavailable && 'opacity-60',
        className,
      )}
    >
      {!trailingPlayControl && (
        <div className="relative grid place-items-center h-8 w-8 justify-self-center">
          {showRank && !active && (
            <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm tabular-nums text-muted-foreground group-hover:opacity-0 transition-opacity">
              {index + 1}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={cn('h-8 w-8', showRank && !active && 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity')}
            onClick={() => (active ? onToggle?.() : onPlay?.())}
            disabled={unavailable}
            aria-label={unavailable ? 'Unavailable' : active && playing ? 'Pause' : 'Play'}
          >
            {active && playing ? <PauseIcon className="h-3.5 w-3.5" /> : <PlayIcon className="h-3.5 w-3.5" />}
          </Button>
        </div>
      )}

      <div data-testid="track-row-title-cell" className="flex items-center gap-3 min-w-0">
        {artwork}
        <div className="min-w-0">
          <div
            data-testid="track-row-title"
            onClick={playOrToast}
            className={cn('truncate text-sm font-semibold', emberTitle, unavailable && 'text-muted-foreground')}
          >
            {track.title}
            {unavailable && (
              <span
                data-testid="unavailable-badge"
                title={reasonLabel(track.unavailableReason)}
                className="ml-2 rounded-full border px-1.5 text-[10px] uppercase tracking-wider text-muted-foreground align-middle"
              >
                Unavailable
              </span>
            )}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {track.artistId ? (
              // stopPropagation so following the artist link never counts as
              // a click on the row.
              <Link href={`/artist/${track.artistId}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                {track.artist}
              </Link>
            ) : (
              track.artist
            )}
          </div>
        </div>
      </div>

      {/* Both desktop-only cells are always rendered so the 5-column grid
          keeps its shape; the flags decide what goes in them. Same @3xl
          switch as the grid-cols above: a plain `hidden md:block` (window
          width) could show these while the grid itself (now keyed off the
          container) is still in its 3-column shape, leaving them as
          unaccounted-for extra grid items. */}
      <div data-testid="track-row-album-cell" className="hidden @3xl:block truncate text-sm text-muted-foreground">{showAlbum ? track.album : ''}</div>
      <div className="hidden @3xl:block text-sm text-muted-foreground text-right tabular-nums">{showTime ? duration : ''}</div>

      <div className="flex items-center gap-1">
        {playControl}
        {trailing}
        {like}
        {replace}
        {remove}
      </div>
    </div>
  );
}
