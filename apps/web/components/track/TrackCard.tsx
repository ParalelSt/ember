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
  /** 'card' (default): the boxed card of the desktop shelves. 'tile': the
   *  phone Home row's bare tile, a square cover with the title (up to two
   *  lines) and artist below it, and the current track marked in ember.
   *  'tile-lg': the desktop Home row's tile, the same with bigger type and a
   *  play button that slides up on hover. */
  variant?: 'card' | 'tile' | 'tile-lg';
  /** The tile's kind word before the artist ("Song" reads "Song · Artist"),
   *  like Spotify's Recents tiles. Omit for the artist alone. */
  kind?: string;
  className?: string;
}

function ArtistLine({ track, className, kind }: { track: Track; className: string; kind?: string }) {
  return (
    <div className={className}>
      {kind ? `${kind} · ` : null}
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
  );
}

/** Presentational only: a square track card with a hover-revealed play
 *  button. Playback state and the activate handler come from props. */
export function TrackCard({ track, active = false, playing = false, onActivate, subtitle, artworkFallback, variant = 'card', kind, className }: Props) {
  if (variant === 'tile' || variant === 'tile-lg') {
    const lg = variant === 'tile-lg';
    return (
      <div
        onClick={onActivate}
        data-active={active || undefined}
        className={cn('group min-w-0 cursor-pointer select-none', className)}
      >
        <div className="relative">
          <Artwork
            src={track.artworkUrl}
            loading="lazy"
            className={cn(
              'aspect-square w-full rounded-[8px] bg-art',
              !track.artworkUrl && artworkFallback && 'grid place-items-center text-foreground/20',
            )}
          >
            {artworkFallback}
          </Artwork>
          <PlayButton
            size="sm"
            playing={active && playing}
            onClick={(e) => { e.stopPropagation(); onActivate(); }}
            className={cn(
              'absolute right-2 bottom-2 shadow-soft',
              // The current track keeps its button showing (pause while it
              // plays); the rest stay clean until focused by keyboard, and on
              // a desktop until hovered, when it slides up into place.
              lg ? 'transition-[opacity,translate]' : 'transition-opacity',
              active
                ? 'opacity-100'
                : lg
                  ? 'translate-y-2 opacity-0 group-hover:translate-y-0 group-hover:opacity-100 focus-visible:translate-y-0 focus-visible:opacity-100'
                  : 'opacity-0 focus-visible:opacity-100',
            )}
          />
        </div>
        <div
          className={cn(
            'mt-cluster line-clamp-2 break-words font-bold leading-snug',
            lg ? 'text-[15px]' : 'text-sm',
            active ? 'text-ember' : 'text-foreground',
          )}
        >
          {track.title}
        </div>
        <ArtistLine track={track} kind={kind} className={cn('mt-inset truncate text-muted-foreground', lg ? 'text-[13px]' : 'text-xs')} />
        {subtitle != null && (
          <div className={cn('mt-inset truncate text-ember', lg ? 'text-[13px]' : 'text-xs')}>{subtitle}</div>
        )}
      </div>
    );
  }
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
          'aspect-square w-full rounded-lg bg-art shadow-soft',
          !track.artworkUrl && artworkFallback && 'grid place-items-center text-foreground/20',
        )}
      >
        {artworkFallback}
      </Artwork>
      <div className="mt-3 truncate text-sm font-semibold">{track.title}</div>
      <ArtistLine track={track} className="mt-1 truncate text-xs text-muted-foreground" />
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
            : 'opacity-0 translate-y-2 group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0 focus-visible:opacity-100 focus-visible:translate-y-0',
        )}
      />
    </div>
  );
}
