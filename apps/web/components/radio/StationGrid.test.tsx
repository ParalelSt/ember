import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { StationGrid, formatDistance, stationTileLine } from './StationGrid';
import { stationTrack, type RadioStation } from '@/lib/radio/station';

const player = vi.hoisted(() => ({
  current: null as { id: string } | null,
  isPlaying: false,
  playTrack: vi.fn(),
  toggle: vi.fn(),
}));
vi.mock('@/components/player/PlayerProvider', () => ({ usePlayer: () => player }));

const station = (n: number, name: string, extra: Partial<RadioStation> = {}): RadioStation => {
  const base = {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    name,
    favicon: null as string | null,
    country: 'Croatia',
    countryCode: 'HR',
    state: 'Zagreb',
    codec: 'MP3',
    bitrate: 128,
    votes: 1,
    distanceKm: null as number | null,
    ...extra,
  };
  return { ...base, track: stationTrack(base) };
};

const NEAR = [
  station(1, 'Narodni radio', { distanceKm: 3.2, favicon: 'https://logo.test/narodni.png' }),
  station(2, 'HR 2', { distanceKm: 0.4 }),
  station(3, 'Antena Zagreb', { distanceKm: 12.6 }),
];

const onToggleFavorite = vi.fn();
const grid = (stations = NEAR, favorites: string[] = []) =>
  render(<StationGrid stations={stations} name="Nearby" favoriteIds={new Set(favorites)} onToggleFavorite={onToggleFavorite} />);
const tiles = () => screen.getAllByTestId('station-tile');

beforeEach(() => {
  vi.clearAllMocks();
  player.current = null;
  player.isPlaying = false;
});

describe('StationGrid (the Radio page, carlayout2 "Logo grid")', () => {
  it('shows the stations as a grid of big square logos, name and distance under each', () => {
    grid();
    expect(screen.getByTestId('station-grid')).toHaveClass('grid', 'grid-cols-2', 'lg:grid-cols-5');
    expect(tiles().map((t) => t.textContent)).toEqual(['Narodni radio3 km', 'HR 2Under 1 km', 'Antena Zagreb13 km']);
    const logo = tiles()[0].querySelector('img')!;
    expect(logo).toHaveAttribute('src', 'https://logo.test/narodni.png');
    expect(logo.parentElement).toHaveClass('aspect-square', 'w-full');
    // No logo: the radio icon on the same square.
    expect(tiles()[1].querySelector('img')).toBeNull();
    expect(tiles()[1].querySelector('.aspect-square svg')).not.toBeNull();
  });

  it('a list with no distances (Favourites, a country) says where each station is', () => {
    grid([station(4, 'Otvoreni')]);
    expect(tiles()[0].textContent).toBe('OtvoreniZagreb, Croatia');
  });

  it('a tap plays the station with the grid as its list', () => {
    grid();
    fireEvent.click(screen.getByRole('button', { name: 'Play HR 2' }));
    expect(player.playTrack).toHaveBeenCalledWith(NEAR[1].track, NEAR.map((s) => s.track), { type: 'stations', name: 'Nearby' });
  });

  it('the station playing is marked in ember, and a tap on it pauses', () => {
    player.current = { id: NEAR[0].track.id };
    player.isPlaying = true;
    grid();
    expect(tiles()[0]).toHaveAttribute('data-playing', 'true');
    expect(within(tiles()[0]).getByText('Narodni radio')).toHaveClass('text-ember');
    expect(tiles()[0].querySelector('.aspect-square')).toHaveClass('ring-ember');
    fireEvent.click(screen.getByRole('button', { name: 'Pause Narodni radio' }));
    expect(player.toggle).toHaveBeenCalledTimes(1);
    expect(player.playTrack).not.toHaveBeenCalled();
  });

  it('the heart favourites a station without playing it', () => {
    grid(NEAR, [NEAR[2].id]);
    fireEvent.click(screen.getByRole('button', { name: 'Favourite HR 2' }));
    expect(onToggleFavorite).toHaveBeenCalledWith(NEAR[1], true);
    fireEvent.click(screen.getByRole('button', { name: 'Favourite Antena Zagreb' }));
    expect(onToggleFavorite).toHaveBeenCalledWith(NEAR[2], false);
    expect(player.playTrack).not.toHaveBeenCalled();
  });

  it('formats distances', () => {
    expect(formatDistance(0.2)).toBe('Under 1 km');
    expect(formatDistance(1)).toBe('1 km');
    expect(formatDistance(7.5)).toBe('8 km');
    expect(stationTileLine(station(5, 'X', { distanceKm: 0 }))).toBe('Under 1 km');
  });
});
