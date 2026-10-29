import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { StationCard, stationCardLine } from './StationCard';
import { StationShelf } from './StationShelf';
import { _resetStationColors } from '@/hooks/useStationColor';
import { fallbackTileColor } from '@/lib/radio/logoColor';
import { stationTrack, type RadioStation } from '@/lib/radio/station';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const player = vi.hoisted(() => ({ current: null as { id: string } | null, isPlaying: false, playTrack: vi.fn(), toggle: vi.fn() }));
vi.mock('@/components/player/PlayerProvider', () => ({ usePlayer: () => player }));

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function station(n: number, opts: Partial<RadioStation> = {}): RadioStation {
  const base = {
    id: ID(n), name: `Station ${n}`, favicon: null as string | null, country: 'Croatia', countryCode: 'HR', state: 'Grad Zagreb',
    codec: 'MP3', bitrate: 128, votes: n, distanceKm: null as number | null, ...opts,
  };
  return { ...base, track: stationTrack(base) };
}

/** A canvas that reads every pixel as `rgba`. */
function fakeCanvas(rgba: [number, number, number, number] | null) {
  const real = document.createElement.bind(document);
  return vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
    const el = real(tag);
    if (tag === 'canvas') {
      Object.defineProperty(el, 'getContext', {
        value: () => (rgba ? {
          drawImage: () => {},
          getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(Array.from({ length: w * h }, () => rgba).flat()) }),
        } : null),
      });
    }
    return el;
  }) as typeof document.createElement);
}

function renderCard(s: RadioStation, props: Partial<ComponentProps<typeof StationCard>> = {}) {
  const onActivate = vi.fn();
  const onToggleFavorite = vi.fn();
  const r = render(
    <StationCard station={s} variant="tile-lg" active={false} playing={false} onActivate={onActivate} favorite={false} onToggleFavorite={onToggleFavorite} {...props} />,
  );
  return { ...r, onActivate, onToggleFavorite };
}

beforeEach(() => {
  _resetStationColors();
  vi.clearAllMocks();
  player.current = null;
  player.isPlaying = false;
});
afterEach(() => vi.restoreAllMocks());

describe('stationCardLine', () => {
  it('reads the region, and the distance when it is known', () => {
    expect(stationCardLine(station(1))).toBe('Grad Zagreb');
    expect(stationCardLine(station(1, { distanceKm: 3.2 }))).toBe('Grad Zagreb · 3 km');
    expect(stationCardLine(station(1, { state: '', distanceKm: 0.3 }))).toBe('Croatia · Under 1 km');
  });
});

describe('StationCard', () => {
  it('shows the name on one line and the region below it', () => {
    renderCard(station(1, { distanceKm: 12 }));
    expect(screen.getByText('Station 1')).toHaveClass('truncate');
    expect(screen.getByText('Grad Zagreb · 12 km')).toBeTruthy();
  });

  it('loads the logo through the host, and paints the tile in the logo\'s colour', () => {
    fakeCanvas([20, 60, 160, 255]);
    renderCard(station(1, { favicon: 'https://logo.example/a.png' }));
    const img = document.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(`/api/radio/logo/${ID(1)}`);
    expect(img).toHaveClass('object-contain');
    expect(screen.getByTestId('station-tile')).not.toHaveAttribute('data-tile-color');
    act(() => { fireEvent.load(img); });
    expect(screen.getByTestId('station-tile')).toHaveAttribute('data-tile-color', 'rgb(20 60 160)');
  });

  it('remembers a station\'s colour, so the next tile for it paints at once', () => {
    const spy = fakeCanvas([20, 60, 160, 255]);
    const s = station(1, { favicon: 'https://logo.example/a.png' });
    const { unmount } = renderCard(s);
    act(() => { fireEvent.load(document.querySelector('img')!); });
    unmount();
    spy.mockClear();
    renderCard(s);
    expect(screen.getByTestId('station-tile')).toHaveAttribute('data-tile-color', 'rgb(20 60 160)');
    expect(spy).not.toHaveBeenCalledWith('canvas');
  });

  it('falls back to the station\'s own steady colour when the logo cannot be read', () => {
    fakeCanvas(null);
    renderCard(station(1, { favicon: 'https://logo.example/a.png' }));
    act(() => { fireEvent.load(document.querySelector('img')!); });
    expect(screen.getByTestId('station-tile')).toHaveAttribute('data-tile-color', fallbackTileColor(ID(1)));
    expect(document.querySelector('img')).toBeTruthy();
  });

  it('shows the initials on the steady colour when there is no logo, or it fails to load', () => {
    renderCard(station(1, { name: 'Radio Sljeme' }));
    expect(screen.getByTestId('station-initials')).toHaveTextContent('RS');
    expect(screen.getByTestId('station-tile')).toHaveAttribute('data-tile-color', fallbackTileColor(ID(1)));
    _resetStationColors();
    const { container } = renderCard(station(2, { name: 'Otvoreni', favicon: 'https://logo.example/b.png' }));
    act(() => { fireEvent.error(container.querySelector('img')!); });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-testid="station-initials"]')).toHaveTextContent('O');
  });

  it('the heart keeps a favourite and never plays the station', () => {
    const { onActivate, onToggleFavorite } = renderCard(station(1));
    const heart = screen.getByRole('button', { name: 'Favourite Station 1' });
    expect(heart).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(heart);
    expect(onToggleFavorite).toHaveBeenCalledWith(expect.objectContaining({ id: ID(1) }), true);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('a desktop tile shows an unset heart on hover only; a set one, and every phone heart, always', () => {
    const { unmount } = renderCard(station(1));
    expect(screen.getByRole('button', { name: 'Favourite Station 1' })).toHaveClass('opacity-0', 'group-hover:opacity-100');
    unmount();
    const { unmount: u2 } = renderCard(station(1), { favorite: true });
    expect(screen.getByRole('button', { name: 'Favourite Station 1' })).not.toHaveClass('opacity-0');
    expect(screen.getByRole('button', { name: 'Favourite Station 1' })).toHaveAttribute('aria-pressed', 'true');
    u2();
    renderCard(station(1), { variant: 'tile' });
    expect(screen.getByRole('button', { name: 'Favourite Station 1' })).not.toHaveClass('opacity-0');
  });
});

describe('StationShelf', () => {
  const stations = Array.from({ length: 12 }, (_, i) => station(i + 1));
  const renderShelf = (variant: 'phone' | 'desktop' = 'phone') =>
    render(<StationShelf title="Nearby" name="Nearby" stations={stations} favoriteIds={new Set([ID(2)])} onToggleFavorite={vi.fn()} variant={variant} />);

  it('holds every station, past the Home row cap, with no Show all', () => {
    renderShelf();
    expect(screen.getAllByRole('listitem')).toHaveLength(12);
    expect(screen.queryByText('Show all')).toBeNull();
  });

  it('uses the Home row of each size', () => {
    const { unmount } = renderShelf('phone');
    expect(screen.getByRole('list')).toHaveAttribute('data-row-shelf');
    unmount();
    renderShelf('desktop');
    expect(screen.getByRole('list')).toHaveAttribute('data-row-shelf', 'wide');
  });

  it('plays a station with the whole section as its queue', () => {
    renderShelf();
    fireEvent.click(screen.getByText('Station 3'));
    expect(player.playTrack).toHaveBeenCalledWith(stations[2].track, stations.map((s) => s.track), { type: 'stations', name: 'Nearby' });
  });

  it('a tap on the station playing pauses it, and its button shows pause', () => {
    player.current = { id: stations[0].track.id };
    player.isPlaying = true;
    renderShelf();
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveClass('opacity-100');
    fireEvent.click(screen.getByText('Station 1'));
    expect(player.toggle).toHaveBeenCalled();
    expect(player.playTrack).not.toHaveBeenCalled();
  });

  it('marks the favourites\' hearts', () => {
    renderShelf();
    expect(screen.getByRole('button', { name: 'Favourite Station 2' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Favourite Station 1' })).toHaveAttribute('aria-pressed', 'false');
  });
});
