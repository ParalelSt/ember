'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Artwork } from '@/components/primitives/Artwork';
import { PlayButton } from '@/components/primitives/PlayButton';
import type { Track } from '@/types/track';
import { cn } from '@/lib/utils';

interface Props {
  track: Track;
  /** This card's track is the player's current one. */
  active?: boolean;
  /** The player is playing: only meaningful together with `active`. */
  playing?: boolean;
  /** Tapping the card or its button. The caller decides what that means
   *  (toggle when this track is already current, otherwise start it). */
  onActivate: () => void;
  /** Optional third line below the artist, e.g. FriendsListening's
   *  "<name> · <time ago>". Omitted entirely (no empty line) when not
   *  given, so Home's cards render exactly as before. */
  subtitle?: ReactNode;
  /** Rendered inside the artwork box when the track has no art (icon,
   *  initials). Omit and artless cards show a plain box. */
  artworkFallback?: ReactNode;
  className?: string;
}

/** Presentational only: a square track card with a hover-revealed play
 *  button. Playback state and the activate handler come from props. */
export function TrackCard({ track, active = false, playing = false, onActivate, subtitle, artworkFallback, className }: Props) {
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
        className={cn(
          'aspect-square w-full rounded-lg bg-black shadow-soft',
          !track.artworkUrl && artworkFallback && 'grid place-items-center text-foreground/20',
        )}
      >
        {artworkFallback}
      </Artwork>
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
      {subtitle != null && (
        <div className="mt-1.5 truncate text-xs text-ember">{subtitle}</div>
      )}
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
