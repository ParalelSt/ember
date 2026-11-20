import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { RowShelf } from './RowShelf';
import { RowNavProvider, type RowNav } from './RowNavContext';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));

afterEach(() => vi.restoreAllMocks());

const HOME: RowNav = { fit: true };

function shelf(variant: 'phone' | 'desktop', nav: RowNav, n: number, props: Partial<ComponentProps<typeof RowShelf>> = {}) {
  return render(
    <RowNavProvider value={nav}>
      <RowShelf variant={variant} title="Your mixes" rowKey="mixes" limit={Infinity} {...props}>
        {Array.from({ length: n }, (_, i) => (
          <div key={i}>{`tile ${i}`}</div>
        ))}
      </RowShelf>
    </RowNavProvider>,
  );
}

/** The fitted desktop row measures its own width before paint. */
function rowWidth(px: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(px);
}

describe('Home rows on desktop (whole cards, Show all)', () => {
  it('shows as many whole cards as fit in one line, and Show all to the row\'s full grid', () => {
    rowWidth(1000); // 5 * 180 + 4 * 16 = 964
    shelf('desktop', HOME, 8);
    const region = within(screen.getByRole('region', { name: 'Your mixes' }));
    const list = region.getByRole('list');
    expect(list).not.toHaveClass('overflow-x-auto');
    expect(list).toHaveClass('grid');
    expect(region.getAllByRole('listitem')).toHaveLength(5);
    expect(region.getByRole('link', { name: 'Show all' })).toHaveAttribute('href', '/?row=mixes');
    expect(region.queryByRole('button', { name: /Scroll/ })).toBeNull();
  });

  it('shows more cards in a wider window', () => {
    rowWidth(1500); // 7 * 180 + 6 * 16 = 1356, 8 would need 1552
    shelf('desktop', HOME, 12);
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
  });

  it('has no Show all when every card fits', () => {
    rowWidth(1000);
    shelf('desktop', HOME, 4);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.queryByRole('link', { name: 'Show all' })).toBeNull();
  });

  it('the Show all page is every card in a grid under Back and the title', () => {
    rowWidth(1000);
    shelf('desktop', { fit: true, fullRow: true }, 12);
    expect(screen.getAllByRole('listitem')).toHaveLength(12);
    expect(screen.getByRole('heading', { level: 1, name: 'Your mixes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/');
  });

  it('the Show all page holds every card even for a row drawn as a grid (Charts chip)', () => {
    shelf('desktop', { fit: true, fullRow: true }, 12, { layout: 'grid' });
    expect(screen.getAllByRole('listitem')).toHaveLength(12);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });
});

describe('Home rows on a phone (two whole cards, Show all)', () => {
  it('shows exactly two whole cards and no sideways scroll', () => {
    shelf('phone', HOME, 7);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('list')).toHaveClass('grid', 'grid-cols-2');
    expect(screen.getByRole('list')).not.toHaveClass('overflow-x-auto');
  });

  it('has Show all only past two cards, linking to the row page', () => {
    const { unmount } = shelf('phone', HOME, 3);
    expect(screen.getByRole('link', { name: 'Show all' })).toHaveAttribute('href', '/?row=mixes');
    unmount();
    shelf('phone', HOME, 2);
    expect(screen.queryByRole('link', { name: 'Show all' })).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('the row page lists every card in two columns under a Back button', () => {
    shelf('phone', { fit: true, fullRow: true }, 7);
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getByRole('list')).toHaveClass('grid-cols-2');
    expect(screen.getByRole('heading', { level: 1, name: 'Your mixes' })).toBeInTheDocument();
    expect(document.querySelector('[data-row-full]')).not.toBeNull();
  });

  it('a filter chip grid stays a grid with every card', () => {
    shelf('phone', HOME, 5, { layout: 'grid' });
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });
});

describe('rows outside Home keep their sideways scroller', () => {
  it('a phone row still scrolls and a desktop row keeps its edge fades', () => {
    const { unmount } = shelf('phone', {}, 7);
    expect(screen.getByRole('list')).toHaveClass('overflow-x-auto', 'snap-x');
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    unmount();
    shelf('desktop', {}, 7);
    expect(document.querySelector('[data-row-shelf="wide"]')).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Scroll right' })).toHaveAttribute('data-row-fade', 'right');
  });
});
