'use client';

import Link from 'next/link';
import { usePlayer } from '@/components/player/PlayerProvider';
import { PlayIcon, PauseIcon } from '@/components/icons';
import type { PlaybackContext, Track } from '@/types/track';
import { cn } from '@/lib/utils';

interface Props {
  track: Track;
  list?: Track[];
  className?: string;
  /** Where this card lives — drives radio behavior after the queue ends. */
  context?: PlaybackContext | null;
}

export function TrackCard({ track, list, className, context }: Props) {
  const { playTrack, current, isPlaying, toggle } = usePlayer();
  const isCurrent = current?.id === track.id;
  // Tapping the card or its button: if this card's track is already the
  // current one, toggle play/pause; otherwise start it fresh.
  const activate = () => (isCurrent ? toggle() : playTrack(track, list, context));
  return (
    <div
      onClick={activate}
      className={cn(
        'group relative p-4 rounded-xl bg-card hover:bg-card/80 transition-colors cursor-pointer',
        className,
      )}
    >
      <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-black shadow-soft">
        {track.artworkUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={track.artworkUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="mt-3 truncate text-sm font-semibold">{track.title}</div>
      <div className="mt-1 truncate text-xs text-muted-foreground">
        {track.artistId ? (
          <Link
            href={`/artist/${track.artistId}`}
            onClick={(e) => e.stopPropagation()}
            className="hover:underline"
          >
            {track.artist}
          </Link>
        ) : (
          track.artist
        )}
      </div>
      <button
        onClick={(e) => { e.stopPropagation(); activate(); }}
        className={cn(
          'absolute right-4 bottom-14 grid h-10 w-10 place-items-center rounded-full bg-ember text-white shadow-glow transition-all',
          // The playing card keeps its button visible (showing pause);
          // idle cards reveal it on hover.
          isCurrent && isPlaying
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0',
        )}
        aria-label={isCurrent && isPlaying ? 'Pause' : 'Play'}
      >
        {isCurrent && isPlaying
          ? <PauseIcon className="h-4 w-4 fill-current" />
          : <PlayIcon className="h-4 w-4 fill-current" />}
      </button>
    </div>
  );
}
