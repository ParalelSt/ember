import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StationList, formatDistance } from './StationList';
import { stationTrack, type RadioStation } from '@/lib/radio/station';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const player = vi.hoisted(() => ({ current: null, isPlaying: false, playTrack: vi.fn(), toggle: vi.fn() }));
vi.mock('@/components/player/PlayerProvider', () => ({ usePlayer: () => player }));

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function station(n: number, distanceKm: number | null): RadioStation {
  const base = {
    id: ID(n), name: `Station ${n}`, favicon: null, country: 'Croatia', countryCode: 'HR', state: 'Grad Zagreb',
    codec: 'MP3', bitrate: 128, votes: n, distanceKm,
  };
  return { ...base, track: stationTrack(base) };
}

function renderList(stations: RadioStation[]) {
  return render(<StationList stations={stations} name="Nearby" favoriteIds={new Set()} onToggleFavorite={vi.fn()} />);
}

describe('StationList', () => {
  it('pads every row like a song list, so the play button keeps clear of the row edge', () => {
    renderList([station(1, 3), station(2, null)]);
    expect(screen.getByTestId('station-list')).toHaveClass('-mx-row');
    for (const row of screen.getAllByTestId('track-row')) expect(row).toHaveClass('px-row');
  });

  it('shows the distance only for a station that has one', () => {
    renderList([station(1, 3), station(2, null)]);
    expect(screen.getAllByTestId('station-distance').map((e) => e.textContent)).toEqual(['3 km']);
  });

  it('plays the station from its row', () => {
    const stations = [station(1, 3)];
    renderList(stations);
    fireEvent.click(screen.getByText('Station 1'));
    expect(player.playTrack).toHaveBeenCalledWith(stations[0].track, [stations[0].track], { type: 'stations', name: 'Nearby' });
  });

  it('formats a distance', () => {
    expect(formatDistance(0.4)).toBe('Under 1 km');
    expect(formatDistance(12.6)).toBe('13 km');
  });
});
