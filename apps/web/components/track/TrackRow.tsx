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
  const hasArtwork = !!track.artworkUrl || artworkFallback !== undefined;

  const artwork = hasArtwork ? (
    <Artwork
      src={track.artworkUrl}
      size="xs"
      onClick={compact ? undefined : playOrToast}
      className={cn(
        'rounded shrink-0 bg-black',
        !track.artworkUrl && 'grid place-items-center text-foreground/20',
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
          ? 'h-7 w-7 opacity-0 group-hover:opacity-100 max-md:opacity-100 transition-opacity'
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

  if (compact) {
    return (
      <div
        onClick={onPlay}
        className={cn(
          'group flex items-center gap-3 px-3 py-2 rounded-md transition-colors',
          onPlay && 'cursor-pointer hover:bg-card',
          active && 'text-ember',
          className,
        )}
      >
        {artwork}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{track.title}</div>
          {/* Plain text, not a link: these rows sit inside a sheet, a
              recents list and a picker, where a stray navigation would
              throw away what the user was doing. */}
          <div className={cn('truncate text-xs', SUBTLE[tone])}>{track.artist}</div>
        </div>
        {showTime && <div className={cn('text-xs tabular-nums', SUBTLE[tone])}>{duration}</div>}
        {trailing}
        {like}
        {remove}
      </div>
    );
  }

  return (
    <div
      data-unavailable={unavailable ? 'true' : undefined}
      onDoubleClick={playOrToast}
      className={cn(
        'group grid grid-cols-[40px_minmax(0,1fr)_auto] md:grid-cols-[40px_minmax(0,1fr)_minmax(0,1fr)_60px_auto] gap-3 items-center px-3 py-2 rounded-md cursor-pointer hover:bg-card transition-colors',
        active && 'text-ember',
        unavailable && 'opacity-60',
        className,
      )}
    >
      <div className="relative grid place-items-center h-8 w-8 justify-self-center">
        {showRank && !active && (
          <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm tabular-nums text-muted-foreground group-hover:opacity-0 transition-opacity">
            {index + 1}
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          className={cn('h-8 w-8', showRank && !active && 'opacity-0 group-hover:opacity-100 transition-opacity')}
          onClick={() => (active ? onToggle?.() : onPlay?.())}
          disabled={unavailable}
          aria-label={unavailable ? 'Unavailable' : active && playing ? 'Pause' : 'Play'}
        >
          {active && playing ? <PauseIcon className="h-3.5 w-3.5" /> : <PlayIcon className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <div className="flex items-center gap-3 min-w-0">
        {artwork}
        <div className="min-w-0">
          <div
            onClick={playOrToast}
            className={cn('truncate text-sm font-semibold', unavailable && 'text-muted-foreground')}
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
          keeps its shape; the flags decide what goes in them. */}
      <div className="hidden md:block truncate text-sm text-muted-foreground">{showAlbum ? track.album : ''}</div>
      <div className="hidden md:block text-sm text-muted-foreground text-right tabular-nums">{showTime ? duration : ''}</div>

      <div className="flex items-center gap-1">
        {trailing}
        {like}
        {replace}
        {remove}
      </div>
    </div>
  );
}
