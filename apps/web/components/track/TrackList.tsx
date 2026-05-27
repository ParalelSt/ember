'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { HeartIcon, PauseIcon, PlayIcon, TrashIcon } from '@/components/icons';
import { AddToPlaylistMenu } from './AddToPlaylistMenu';
import { usePlayer } from '@/components/player/PlayerProvider';
import { useAuth } from '@/components/providers/AuthProvider';
import { useExecuteToggleLike, useQueryLikes } from '@/hooks/useLibrary';
import type { PlaybackContext, Track } from '@/types/track';
import { cn } from '@/lib/utils';

function fmt(sec: number | undefined): string {
  if (!sec || !isFinite(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

interface Props {
  tracks: Track[];
  showAlbum?: boolean;
  onRemove?: (trackId: string) => void;
  /** Where this list lives — drives radio behavior after the queue ends. */
  context?: PlaybackContext | null;
}

export function TrackList({ tracks, showAlbum = true, onRemove, context }: Props) {
  const { current, isPlaying, playTrack, toggle } = usePlayer();
  const { user } = useAuth();
  const { data: liked = [] } = useQueryLikes();
  const toggleLike = useExecuteToggleLike();

  const onLike = (track: Track) => {
    if (!user) {
      window.alert('Sign in to like tracks');
      return;
    }
    toggleLike.mutate({ track, wasLiked: liked.some((t) => t.id === track.id) });
  };

  if (!tracks?.length) return <div className="text-muted-foreground text-sm py-12 text-center">No tracks</div>;

  return (
    <div className="flex flex-col">
      {tracks.map((t) => {
        const playing = current?.id === t.id;
        const isLiked = liked.some((x) => x.id === t.id);
        return (
          <div
            key={t.id}
            onDoubleClick={() => playTrack(t, tracks, context)}
            className={cn(
              'group grid grid-cols-[40px_minmax(0,1fr)_auto] md:grid-cols-[40px_minmax(0,1fr)_minmax(0,1fr)_60px_auto] gap-3 items-center px-3 py-2 rounded-md cursor-pointer hover:bg-card transition-colors',
              playing && 'text-ember',
            )}
          >
            <div className="grid place-items-center">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => (playing ? toggle() : playTrack(t, tracks, context))}
                aria-label={playing && isPlaying ? 'Pause' : 'Play'}
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
                  onClick={() => playTrack(t, tracks, context)}
                  className="h-10 w-10 rounded shrink-0 object-cover bg-black"
                />
              )}
              <div className="min-w-0">
                <div onClick={() => playTrack(t, tracks, context)} className="truncate text-sm font-semibold">
                  {t.title}
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
              <AddToPlaylistMenu track={t} />
              <Button
                variant="ghost"
                size="icon"
                className={cn('h-8 w-8 text-muted-foreground hover:text-foreground', isLiked && 'text-ember hover:text-ember')}
                onClick={() => onLike(t)}
                aria-label={isLiked ? 'Unlike' : 'Like'}
              >
                <HeartIcon className="h-4 w-4" fill={isLiked ? 'currentColor' : 'none'} />
              </Button>
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
