'use client';

import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { HeartIcon, PauseIcon, PlayIcon, RefreshIcon, TrashIcon } from '@/components/icons';
import { AddToPlaylistMenu } from './AddToPlaylistMenu';
import { ShareButton } from './ShareButton';
import { findLikedVariant } from '@/lib/songKey';
import { usePlayer } from '@/components/player/PlayerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { useExecuteToggleLike, useQueryLikes } from '@/hooks/useLibrary';
import { isUnavailable } from '@/lib/playback/skipUnavailable';
import type { PlaybackContext, Track } from '@/types/track';
import { cn } from '@/lib/utils';

function fmt(sec: number | undefined): string {
  if (!sec || !isFinite(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Words for `unavailableReason` codes — shown as the badge's `title`
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

interface Props {
  tracks: Track[];
  showAlbum?: boolean;
  /** Show a 1-based rank number in the leading column — hidden on hover so
   *  the play/pause button takes over. Used on the artist "Popular" list. */
  showRank?: boolean;
  onRemove?: (trackId: string) => void;
  /** Where this list lives — drives radio behavior after the queue ends. */
  context?: PlaybackContext | null;
  /** Fires whenever this list starts playback of a track (e.g. the search
   *  page uses it to save the query to recent searches). */
  onPlayTrack?: (track: Track) => void;
  /** Opens the find-replacement dialog for an unavailable track. Omitted on
   *  lists where a replacement wouldn't be actionable (e.g. Recently played). */
  onReplace?: (track: Track) => void;
}

export function TrackList({ tracks, showAlbum = true, showRank = false, onRemove, context, onPlayTrack, onReplace }: Props) {
  const { current, isPlaying, playTrack, toggle } = usePlayer();
  const { user } = useAuth();
  const { data: liked = [] } = useQueryLikes();
  const toggleLike = useExecuteToggleLike();

  const onLike = (track: Track) => {
    if (!user) {
      toast.message('Sign in to like tracks', { description: 'Liking saves songs to your library.' });
      return;
    }
    // If a variant of this song is already liked, toggle THAT entry — keeps
    // "1 like per song" across album / music-video / live versions.
    const existing = findLikedVariant(track, liked);
    toggleLike.mutate({ track: existing ?? track, wasLiked: !!existing });
  };

  const play = (track: Track) => {
    onPlayTrack?.(track);
    playTrack(track, tracks, context);
  };

  // The row's double-click / title / artwork handlers all funnel through
  // here: an unavailable track can't actually start playback (the server
  // has confirmed yt-dlp can't fetch it), so clicking it explains why
  // instead of silently doing nothing.
  const playOrToast = (track: Track) => {
    if (isUnavailable(track)) {
      toast.message(`"${track.title}" is unavailable on YouTube`);
      return;
    }
    play(track);
  };

  if (!tracks?.length) return <div className="text-muted-foreground text-sm py-12 text-center">No tracks</div>;

  return (
    <div className="flex flex-col">
      {tracks.map((t, i) => {
        const playing = current?.id === t.id;
        const isLiked = !!findLikedVariant(t, liked);
        const unavailable = isUnavailable(t);
        return (
          <div
            key={t.id}
            data-unavailable={unavailable ? 'true' : undefined}
            onDoubleClick={() => playOrToast(t)}
            className={cn(
              'group grid grid-cols-[40px_minmax(0,1fr)_auto] md:grid-cols-[40px_minmax(0,1fr)_minmax(0,1fr)_60px_auto] gap-3 items-center px-3 py-2 rounded-md cursor-pointer hover:bg-card transition-colors',
              playing && 'text-ember',
              unavailable && 'opacity-60',
            )}
          >
            <div className="relative grid place-items-center h-8 w-8 justify-self-center">
              {showRank && !playing && (
                <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm tabular-nums text-muted-foreground group-hover:opacity-0 transition-opacity">
                  {i + 1}
                </span>
              )}
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-8 w-8',
                  showRank && !playing && 'opacity-0 group-hover:opacity-100 transition-opacity',
                )}
                onClick={() => (playing ? toggle() : play(t))}
                disabled={unavailable}
                aria-label={unavailable ? 'Unavailable' : playing && isPlaying ? 'Pause' : 'Play'}
              >
                {playing && isPlaying ? <PauseIcon className="h-3.5 w-3.5" /> : <PlayIcon className="h-3.5 w-3.5" />}
              </Button>
            </div>

            <div className="flex items-center gap-3 min-w-0">
              {t.artworkUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={t.artworkUrl}
                  alt=""
                  onClick={() => playOrToast(t)}
                  className="h-10 w-10 rounded shrink-0 object-cover bg-black"
                />
              )}
              <div className="min-w-0">
                <div
                  onClick={() => playOrToast(t)}
                  className={cn('truncate text-sm font-semibold', unavailable && 'text-muted-foreground')}
                >
                  {t.title}
                  {unavailable && (
                    <span
                      data-testid="unavailable-badge"
                      title={reasonLabel(t.unavailableReason)}
                      className="ml-2 rounded-full border px-1.5 text-[10px] uppercase tracking-wider text-muted-foreground align-middle"
                    >
                      Unavailable
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {t.artistId ? (
                    <Link href={`/artist/${t.artistId}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                      {t.artist}
                    </Link>
                  ) : (
                    t.artist
                  )}
                </div>
              </div>
            </div>

            <div className="hidden md:block truncate text-sm text-muted-foreground">{showAlbum ? t.album : ''}</div>
            <div className="hidden md:block text-sm text-muted-foreground text-right tabular-nums">{fmt(t.durationSec)}</div>

            <div className="flex items-center gap-1">
              {!unavailable && <AddToPlaylistMenu track={t} />}
              <ShareButton track={t} />
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8 text-muted-foreground hover:text-foreground', isLiked && 'text-ember hover:text-ember')}
                onClick={() => onLike(t)}
                aria-label={isLiked ? 'Unlike' : 'Like'}
              >
                <HeartIcon className="h-4 w-4" fill={isLiked ? 'currentColor' : 'none'} />
              </Button>
              {unavailable && onReplace && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-ember hover:text-ember"
                  onClick={() => onReplace(t)}
                  aria-label="Find replacement"
                  title="Find replacement"
                >
                  <RefreshIcon className="h-3.5 w-3.5" />
                </Button>
              )}
              {onRemove && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground"
                  onClick={() => onRemove(t.id)}
                  aria-label="Remove"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
