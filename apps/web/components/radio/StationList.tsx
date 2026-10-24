'use client';

import { useMemo } from 'react';
import { TrackRow } from '@/components/track/TrackRow';
import { LikeButton } from '@/components/primitives/LikeButton';
import { RadioIcon } from '@/components/icons';
import { usePlayer } from '@/components/player/PlayerProvider';
import type { RadioStation } from '@/lib/radio/station';

const NO_LOGO = <RadioIcon className="h-4 w-4" />;

export interface StationListProps {
  stations: RadioStation[];
  /** The list's name, for the full-screen player ("Live radio: Nearby"). */
  name: string;
  favoriteIds: ReadonlySet<string>;
  onToggleFavorite: (station: RadioStation, favorite: boolean) => void;
}

/** Live stations as track rows: a tap plays the station, and Next and
 *  Previous move through this list as it is shown. The heart keeps it in
 *  the member's favourite stations (never Liked songs). */
export function StationList({ stations, name, favoriteIds, onToggleFavorite }: StationListProps) {
  const { current, isPlaying, playTrack, toggle } = usePlayer();
  const tracks = useMemo(() => stations.map((s) => s.track), [stations]);
  return (
    <div className="@container flex flex-col" data-testid="station-list">
      {stations.map((s, i) => {
        const favorite = favoriteIds.has(s.id);
        return (
          <TrackRow
            key={s.id}
            track={s.track}
            index={i}
            showAlbum={false}
            showDuration={false}
            active={current?.id === s.track.id}
            playing={isPlaying}
            onPlay={() => playTrack(s.track, tracks, { type: 'stations', name })}
            onToggle={toggle}
            artworkFallback={NO_LOGO}
            trailing={(
              <LikeButton
                liked={favorite}
                onToggle={() => onToggleFavorite(s, !favorite)}
                label={`Favourite ${s.name}`}
              />
            )}
          />
        );
      })}
    </div>
  );
}
