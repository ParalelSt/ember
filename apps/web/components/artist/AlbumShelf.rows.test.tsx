import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { AlbumShelf } from './AlbumShelf';
import { RowNavProvider, type RowNav } from '@/components/page/RowNavContext';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));
const state = vi.hoisted(() => ({ desktop: false }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => state.desktop }));

afterEach(() => vi.restoreAllMocks());

const albums = Array.from({ length: 8 }, (_, i) => ({ browseId: `B${i}`, title: `Album ${i}`, year: 2000 + i, thumbnails: [] }));

function shelf(nav: RowNav, n = 8) {
  return render(
    <RowNavProvider value={nav}>
      <AlbumShelf title="Discography" albums={albums.slice(0, n) as never} showAllHref="/artist/X?row=albums" />
    </RowNavProvider>,
  );
}

describe('artist rows (whole cards, Show all)', () => {
  it('phone: two whole cards, no sideways scroll, Show all to the row view', () => {
    state.desktop = false;
    shelf({ fit: true });
    const row = within(screen.getByRole('region', { name: 'Discography' }));
    expect(row.getAllByRole('listitem')).toHaveLength(2);
    expect(row.getByRole('list')).not.toHaveClass('overflow-x-auto');
    expect(row.getByRole('link', { name: 'Show all' })).toHaveAttribute('href', '/artist/X?row=albums');
  });

  it('phone: no Show all when there are two or fewer', () => {
    state.desktop = false;
    shelf({ fit: true }, 2);
    expect(screen.queryByRole('link', { name: 'Show all' })).toBeNull();
  });

  it('desktop: as many whole cards as fit', () => {
    state.desktop = true;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    shelf({ fit: true });
    const row = within(screen.getByRole('region', { name: 'Discography' }));
    expect(row.getAllByRole('listitem')).toHaveLength(5);
    expect(row.getByRole('link', { name: 'Show all' })).toHaveAttribute('href', '/artist/X?row=albums');
  });

  it('row view: every album, Back to the artist, no Show all', () => {
    state.desktop = false;
    shelf({ fit: true, fullRow: true, backHref: '/artist/X' });
    const row = within(screen.getByRole('region', { name: 'Discography' }));
    expect(row.getAllByRole('listitem')).toHaveLength(8);
    expect(row.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/artist/X');
    expect(row.queryByRole('link', { name: 'Show all' })).toBeNull();
  });
});
