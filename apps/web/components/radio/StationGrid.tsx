'use client';

import { useMemo } from 'react';
import { Artwork } from '@/components/primitives/Artwork';
import { LikeButton } from '@/components/primitives/LikeButton';
import { RadioIcon } from '@/components/icons';
import { usePlayer } from '@/components/player/PlayerProvider';
import { cn } from '@/lib/utils';
import type { RadioStation } from '@/lib/radio/station';

export interface StationGridProps {
  stations: RadioStation[];
  /** The list's name, for the full-screen player ("Live radio: Nearby"). */
  name: string;
  favoriteIds: ReadonlySet<string>;
  onToggleFavorite: (station: RadioStation, favorite: boolean) => void;
}

/** "3 km", or "Under 1 km" for a station in the same town. */
export function formatDistance(km: number): string {
  return km < 1 ? 'Under 1 km' : `${Math.round(km)} km`;
}

/** The line under a station's logo: how far it is (Nearby), or where it is. */
export function stationTileLine(s: RadioStation): string {
  return s.distanceKm != null ? formatDistance(s.distanceKm) : s.track.artist;
}

/** Live stations as a grid of big square logos (owner's pick, carlayout2
 *  "Logo grid"), the name and the distance under each. A tap plays the
 *  station, and Next and Previous move through this list as it is shown;
 *  a tap on the one playing pauses or resumes it. The heart keeps it in the
 *  member's favourite stations (never Liked songs). */
export function StationGrid({ stations, name, favoriteIds, onToggleFavorite }: StationGridProps) {
  const { current, isPlaying, playTrack, toggle } = usePlayer();
  const tracks = useMemo(() => stations.map((s) => s.track), [stations]);
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-block" data-testid="station-grid">
      {stations.map((s) => {
        const favorite = favoriteIds.has(s.id);
        const on = current?.id === s.track.id;
        return (
          <div key={s.id} className="relative min-w-0" data-testid="station-tile" data-playing={on || undefined}>
            <button
              type="button"
              onClick={() => (on ? toggle() : playTrack(s.track, tracks, { type: 'stations', name }))}
              aria-label={on && isPlaying ? `Pause ${s.name}` : `Play ${s.name}`}
              className="flex w-full min-w-0 flex-col gap-cluster rounded-xl text-left focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Artwork
                src={s.favicon}
                loading="lazy"
                className={cn(
                  'aspect-square w-full rounded-xl bg-card shadow-soft',
                  !s.favicon && 'grid place-items-center text-foreground/20',
                  on && 'ring-2 ring-ember',
                )}
              >
                <RadioIcon className="size-1/3" />
              </Artwork>
              {/* pr-hit: room for the heart beside the name. */}
              <span className="block min-w-0 pr-hit">
                <span className={cn('block truncate text-sm font-semibold', on && 'text-ember')}>{s.name}</span>
                <span className="block truncate text-xs text-muted-foreground tabular-nums">{stationTileLine(s)}</span>
              </span>
            </button>
            <LikeButton
              liked={favorite}
              onToggle={() => onToggleFavorite(s, !favorite)}
              label={`Favourite ${s.name}`}
              className="absolute right-0 bottom-0"
            />
          </div>
        );
      })}
    </div>
  );
}
