import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { StationShelf } from './StationShelf';
import { RowNavProvider, type RowNav } from '@/components/page/RowNavContext';
import { stationTrack, type RadioStation } from '@/lib/radio/station';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));
vi.mock('@/components/player/PlayerProvider', () => ({
  usePlayer: () => ({ current: null, isPlaying: false, playTrack: vi.fn(), toggle: vi.fn() }),
}));

afterEach(() => vi.restoreAllMocks());

const station = (n: number): RadioStation => {
  const base = { id: `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`, name: `Station ${n}`, favicon: null, country: 'Croatia', countryCode: 'HR', state: '', codec: 'MP3', bitrate: 128, votes: 1, distanceKm: null };
  return { ...base, track: stationTrack(base) };
};
const stations = Array.from({ length: 9 }, (_, i) => station(i + 1));

function shelf(variant: 'phone' | 'desktop', nav: RowNav) {
  return render(
    <RowNavProvider value={nav}>
      <StationShelf title="Croatia" name="Croatia" stations={stations} favoriteIds={new Set()} onToggleFavorite={vi.fn()} variant={variant} showAllHref="/radio?row=nearby" />
    </RowNavProvider>,
  );
}

describe('radio rows (whole cards, Show all)', () => {
  it('phone: two whole cards and Show all to the row view', () => {
    shelf('phone', { fit: true });
    const row = within(screen.getByRole('region', { name: 'Croatia' }));
    expect(row.getAllByRole('listitem')).toHaveLength(2);
    expect(row.getByRole('list')).not.toHaveClass('overflow-x-auto');
    expect(row.getByRole('link', { name: 'Show all' })).toHaveAttribute('href', '/radio?row=nearby');
  });

  it('desktop: as many whole cards as fit', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    shelf('desktop', { fit: true });
    const row = within(screen.getByRole('region', { name: 'Croatia' }));
    expect(row.getAllByRole('listitem')).toHaveLength(5);
    expect(row.getByRole('link', { name: 'Show all' })).toHaveAttribute('href', '/radio?row=nearby');
  });

  it('row view: every station, Back to Radio', () => {
    shelf('phone', { fit: true, fullRow: true, backHref: '/radio' });
    const row = within(screen.getByRole('region', { name: 'Croatia' }));
    expect(row.getAllByRole('listitem')).toHaveLength(9);
    expect(row.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/radio');
  });
});
