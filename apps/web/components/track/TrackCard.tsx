'use client';

import Link from 'next/link';
import { Artwork } from '@/components/primitives/Artwork';
import { PlayButton } from '@/components/primitives/PlayButton';
import type { Track } from '@/types/track';
import { cn } from '@/lib/utils';

interface Props {
  track: Track;
  /** This card's track is the player's current one. */
  active?: boolean;
  /** The player is playing — only meaningful together with `active`. */
  playing?: boolean;
  /** Tapping the card or its button. The caller decides what that means
   *  (toggle when this track is already current, otherwise start it). */
  onActivate: () => void;
  className?: string;
}

/** Presentational only: a square track card with a hover-revealed play
 *  button. Playback state and the activate handler come from props. */
export function TrackCard({ track, active = false, playing = false, onActivate, className }: Props) {
  return (
    <div
      onClick={onActivate}
      className={cn(
        'group relative p-4 rounded-xl bg-card hover:bg-card/80 transition-colors cursor-pointer',
        className,
      )}
    >
      <Artwork
        src={track.artworkUrl}
        loading="lazy"
        className="aspect-square w-full rounded-lg bg-black shadow-soft"
      />
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
      <PlayButton
        size="sm"
        playing={active && playing}
        onClick={(e) => { e.stopPropagation(); onActivate(); }}
        className={cn(
          'absolute right-4 bottom-14 transition-all',
          // The playing card keeps its button visible (showing pause);
          // idle cards reveal it on hover.
          active && playing
            ? 'opacity-100 translate-y-0'
            : 'opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0',
        )}
      />
    </div>
  );
}
