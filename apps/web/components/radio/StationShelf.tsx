'use client';

import { useMemo, type ReactNode } from 'react';
import { RowShelf } from '@/components/page/RowShelf';
import { StationCard } from '@/components/radio/StationCard';
import { usePlayer } from '@/components/player/PlayerProvider';
import type { RadioStation } from '@/lib/radio/station';

export interface StationShelfProps {
  title: string;
  stations: RadioStation[];
  /** The list's name, for the full-screen player ("Live radio: Nearby"). */
  name: string;
  favoriteIds: ReadonlySet<string>;
  onToggleFavorite: (station: RadioStation, favorite: boolean) => void;
  /** 'phone': 140px tiles by touch; 'desktop': 180px tiles, as on Home. */
  variant: 'phone' | 'desktop';
  /** Beside the title (Nearby's "Use my location"). */
  action?: ReactNode;
}

/** A section of stations as a Home style shelf (the owner's "Shelves"
 *  pick): every station of it in one sideways row, with no "Show all" (the
 *  row is the only way to them, so it holds them all). A tap plays the
 *  station, and Next and Previous move through the section as it is shown;
 *  a tap on the one playing pauses or resumes it. */
export function StationShelf({ title, stations, name, favoriteIds, onToggleFavorite, variant, action }: StationShelfProps) {
  const { current, isPlaying, playTrack, toggle } = usePlayer();
  const tracks = useMemo(() => stations.map((s) => s.track), [stations]);
  return (
    <RowShelf title={title} variant={variant} limit={Infinity} action={action}>
      {stations.map((s) => {
        const active = current?.id === s.track.id;
        const favorite = favoriteIds.has(s.id);
        return (
          <StationCard
            key={s.id}
            station={s}
            variant={variant === 'desktop' ? 'tile-lg' : 'tile'}
            active={active}
            playing={isPlaying}
            onActivate={() => (active ? toggle() : playTrack(s.track, tracks, { type: 'stations', name }))}
            favorite={favorite}
            onToggleFavorite={onToggleFavorite}
          />
        );
      })}
    </RowShelf>
  );
}
