'use client';

import { TrackCard } from '@/components/track/TrackCard';
import { LikeButton } from '@/components/primitives/LikeButton';
import { RadioIcon } from '@/components/icons';
import { formatDistance } from '@/components/radio/StationList';
import { useStationColor } from '@/hooks/useStationColor';
import { stationInitials } from '@/lib/radio/logoColor';
import { stationLogoPath, stationRegion, type RadioStation } from '@/lib/radio/station';
import { cn } from '@/lib/utils';

/** A station tile's short line: its region, and how far it is when that is
 *  known ("Grad Zagreb · 3 km"). */
export function stationCardLine(s: Pick<RadioStation, 'state' | 'country' | 'distanceKm'>): string {
  const region = stationRegion(s);
  return s.distanceKm != null ? `${region} · ${formatDistance(s.distanceKm)}` : region;
}

interface TileProps {
  station: RadioStation;
  favorite: boolean;
  onToggleFavorite: (station: RadioStation, favorite: boolean) => void;
  /** 'tile' (phone): the heart always shows, as there is no hover. */
  variant: 'tile' | 'tile-lg';
}

/** The square logo tile (the owner's "Station colour" pick): the logo,
 *  whole and centred, on its own colour; the station's initials on a steady
 *  colour of its own when it has no logo. The heart sits in the corner. */
export function StationTile({ station, favorite, onToggleFavorite, variant }: TileProps) {
  const { background, showLogo, onLogoLoad, onLogoError } = useStationColor(station.id, !!station.favicon);
  const initials = stationInitials(station.name);
  return (
    <div
      data-testid="station-tile"
      data-tile-color={background ?? undefined}
      className="relative aspect-square w-full overflow-hidden rounded-[8px] bg-art transition-colors duration-300"
      style={background ? { backgroundColor: background } : undefined}
    >
      {showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={stationLogoPath(station.id)}
          alt=""
          loading="lazy"
          onLoad={(e) => onLogoLoad(e.currentTarget)}
          onError={onLogoError}
          className="absolute inset-0 h-full w-full object-contain p-[18%]"
        />
      ) : (
        <div data-testid="station-initials" className="absolute inset-0 grid place-items-center text-3xl font-bold tracking-tight text-white/90">
          {initials || <RadioIcon className="h-1/3 w-1/3" />}
        </div>
      )}
      {/* Its own click: the heart never plays the station. */}
      <span className="absolute right-1.5 top-1.5" onClick={(e) => e.stopPropagation()}>
        <LikeButton
          liked={favorite}
          onToggle={() => onToggleFavorite(station, !favorite)}
          label={`Favourite ${station.name}`}
          className={cn(
            'h-7 w-7 rounded-full bg-black/40 hover:bg-black/55 transition-opacity',
            !favorite && 'text-white hover:text-white',
            // A desktop tile keeps a heart that is not set for the hover, as
            // it does the play button; a phone has no hover, so it shows.
            variant === 'tile-lg' && !favorite && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
          )}
        />
      </span>
    </div>
  );
}

export interface StationCardProps extends TileProps {
  active: boolean;
  playing: boolean;
  onActivate: () => void;
}

/** A station as a Home style tile: the logo tile, its name on one line,
 *  its region (and distance) below; the round play button on the tile as
 *  on Home's cards. */
export function StationCard({ station, active, playing, onActivate, favorite, onToggleFavorite, variant }: StationCardProps) {
  return (
    <TrackCard
      track={{ ...station.track, artist: stationCardLine(station) }}
      variant={variant}
      active={active}
      playing={playing}
      onActivate={onActivate}
      titleLines={1}
      cover={<StationTile station={station} favorite={favorite} onToggleFavorite={onToggleFavorite} variant={variant} />}
    />
  );
}
