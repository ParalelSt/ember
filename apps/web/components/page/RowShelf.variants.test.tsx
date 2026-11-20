import type { ComponentProps, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { RowShelf } from './RowShelf';
import { RowNavProvider, type RowNav } from './RowNavContext';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), back: vi.fn() }) }));

afterEach(() => vi.restoreAllMocks());

const TILE = 180;
const GAP = 16;

function shelf(nav: RowNav, n: number, props: Partial<ComponentProps<typeof RowShelf>> = {}, onTile?: () => void) {
  return render(
    <RowNavProvider value={nav}>
      <RowShelf variant="desktop" title="Your mixes" limit={Infinity} {...props}>
        {Array.from({ length: n }, (_, i) => (
          <button key={i} type="button" onClick={onTile}>{`tile ${i}`}</button>
        ))}
      </RowShelf>
    </RowNavProvider>,
  );
}

/** happy-dom lays nothing out: give the row and its tiles the boxes a
 *  browser would (180px tiles, 16px apart, the row `client` px wide). */
function layout(list: HTMLElement, { client, left = 0 }: { client: number; left?: number }) {
  const items = Array.from(list.children) as HTMLElement[];
  const scroll = items.length * (TILE + GAP) - GAP;
  Object.defineProperty(list, 'clientWidth', { configurable: true, value: client });
  Object.defineProperty(list, 'scrollWidth', { configurable: true, value: scroll });
  list.scrollLeft = left;
  const rect = (x: number, w: number) => ({ left: x, right: x + w, width: w, x, y: 0, top: 0, bottom: 260, height: 260, toJSON: () => ({}) }) as DOMRect;
  list.getBoundingClientRect = () => rect(100, client);
  items.forEach((item, i) => {
    item.getBoundingClientRect = () => rect(100 + i * (TILE + GAP) - list.scrollLeft, TILE);
  });
  fireEvent.scroll(list);
}

function stubScrollTo(list: HTMLElement) {
  const scrollTo = vi.fn();
  list.scrollTo = scrollTo as unknown as typeof list.scrollTo;
  return scrollTo;
}

const wideRow = () => document.querySelector<HTMLElement>('[data-row-shelf="wide"]')!;

describe.each([
  ['a', 'header arrows'],
  ['b', 'hover edge arrows'],
] as const)('variant %s (%s)', (variant) => {
  const left = () => screen.getByRole('button', { name: 'Scroll Your mixes left' });
  const right = () => screen.getByRole('button', { name: 'Scroll Your mixes right' });

  it('shows no arrows while everything is in view', () => {
    shelf({ variant }, 3);
    layout(wideRow(), { client: 900 });
    expect(screen.queryByRole('button', { name: /Scroll Your mixes/ })).toBeNull();
  });

  it('pages a screen of whole cards each way, the arrow at an end disabled', () => {
    shelf({ variant }, 10);
    const list = wideRow();
    const scrollTo = stubScrollTo(list);
    // 700px holds cards 0-2 whole; card 3 starts at 588.
    layout(list, { client: 700 });
    expect(left()).toBeDisabled();
    expect(right()).toBeEnabled();
    fireEvent.click(right());
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 588, behavior: 'smooth' });

    layout(list, { client: 700, left: 588 });
    expect(left()).toBeEnabled();
    fireEvent.click(right());
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 1176, behavior: 'smooth' });
    fireEvent.click(left());
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 0, behavior: 'smooth' });

    // At the end (scrollWidth 1944 - 700).
    layout(list, { client: 700, left: 1244 });
    expect(right()).toBeDisabled();
    expect(left()).toBeEnabled();
  });

  it('jumps without smooth scrolling under prefers-reduced-motion', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({ matches: q.includes('reduce'), media: q }) as MediaQueryList);
    shelf({ variant }, 10);
    const list = wideRow();
    const scrollTo = stubScrollTo(list);
    layout(list, { client: 700 });
    fireEvent.click(right());
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 588, behavior: 'auto' });
  });

  it('has focus rings on its arrows', () => {
    shelf({ variant }, 10);
    layout(wideRow(), { client: 700 });
    expect(right()).toHaveClass('focus-visible:ring-3');
  });

  it('keeps a sideways trackpad swipe moving the row', () => {
    shelf({ variant }, 10);
    const list = wideRow();
    layout(list, { client: 700 });
    const e = new WheelEvent('wheel', { deltaX: 120, deltaY: 5, bubbles: true, cancelable: true });
    list.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(list.scrollLeft).toBe(120);
  });

  it('still swallows the click that ends a drag, so a drag opens no card', () => {
    const onTile = vi.fn();
    shelf({ variant }, 10, {}, onTile);
    const tile = screen.getByText('tile 1');
    fireEvent.mouseDown(tile, { button: 0, clientX: 300 });
    fireEvent.mouseMove(window, { clientX: 250 });
    fireEvent.mouseUp(window, { clientX: 250 });
    fireEvent.click(tile);
    expect(onTile).not.toHaveBeenCalled();
    fireEvent.click(tile);
    expect(onTile).toHaveBeenCalledTimes(1);
  });

  it('the edge fades are hints only, never buttons in the way of a card', () => {
    shelf({ variant }, 10);
    layout(wideRow(), { client: 700 });
    expect(screen.queryByRole('button', { name: 'Scroll right' })).toBeNull();
    const fade = document.querySelector('[data-row-fade="right"]')!;
    expect(fade.tagName).toBe('DIV');
    expect(fade).toHaveClass('pointer-events-none');
  });

  it('fades an edge only where a card is cut there, so a whole card at rest is never dimmed', () => {
    shelf({ variant }, 10);
    const list = wideRow();
    const fade = (side: string) => document.querySelector(`[data-row-fade="${side}"]`)!;
    // At 588 card 3 sits flush at the left; card 6 (1176..1356) is cut at 1288.
    layout(list, { client: 700, left: 588 });
    expect(fade('left')).not.toHaveAttribute('data-shown');
    expect(fade('right')).toHaveAttribute('data-shown');
    // Half way into card 3, the left edge is cut.
    layout(list, { client: 700, left: 650 });
    expect(fade('left')).toHaveAttribute('data-shown');
  });

  it('links Show all to the row\'s whole list where it has one', () => {
    const { unmount } = shelf({ variant }, 10, { fullListHref: '/library/recent' });
    expect(screen.getByRole('link', { name: 'Show all' })).toHaveAttribute('href', '/library/recent');
    unmount();
    shelf({ variant }, 10);
    expect(screen.queryByRole('link', { name: 'Show all' })).toBeNull();
  });
});

describe('variant a vs b: where the arrows sit', () => {
  it('a puts them in the title line', () => {
    shelf({ variant: 'a' }, 10);
    layout(wideRow(), { client: 700 });
    const header = screen.getByRole('heading', { level: 2 }).parentElement!;
    expect(within(header).getByRole('button', { name: 'Scroll Your mixes right' })).toBeInTheDocument();
  });

  it('b lays them over the row\'s edges, shown on hover of the row', () => {
    shelf({ variant: 'b' }, 10);
    layout(wideRow(), { client: 700 });
    const right = screen.getByRole('button', { name: 'Scroll Your mixes right' });
    expect(right).toHaveClass('absolute', 'opacity-0', 'group-hover/row:opacity-100', 'focus-visible:opacity-100');
    expect(screen.getByRole('region', { name: 'Your mixes' })).toHaveClass('group/row');
    // Beside the row itself, not in the title line.
    expect(right.parentElement!.contains(wideRow())).toBe(true);
    expect(right.parentElement!.contains(screen.getByRole('heading', { level: 2 }))).toBe(false);
  });
});

/** C and D measure their own width before paint. */
function rowWidth(px: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(px);
}

describe('variant c (no sideways scroll)', () => {
  it('shows as many whole cards as fit in one line, and Show all to the row\'s full grid', () => {
    rowWidth(1000); // 5 * 180 + 4 * 16 = 964
    shelf({ variant: 'c' }, 8, { rowKey: 'mixes' });
    const region = within(screen.getByRole('region', { name: 'Your mixes' }));
    const list = region.getByRole('list');
    expect(list).not.toHaveClass('overflow-x-auto');
    expect(list).toHaveClass('grid');
    expect(region.getAllByRole('listitem')).toHaveLength(5);
    expect(region.getByRole('link', { name: 'Show all' })).toHaveAttribute('href', '/?homerows=c&row=mixes');
    expect(region.queryByRole('button', { name: /Scroll/ })).toBeNull();
  });

  it('has no Show all when every card fits', () => {
    rowWidth(1000);
    shelf({ variant: 'c' }, 4, { rowKey: 'mixes' });
    expect(screen.getAllByRole('listitem')).toHaveLength(4);
    expect(screen.queryByRole('link', { name: 'Show all' })).toBeNull();
  });

  it('the Show all page is every card in a grid under Back and the title', () => {
    rowWidth(1000);
    shelf({ variant: 'c', fullRow: true }, 12, { rowKey: 'mixes' });
    expect(screen.getAllByRole('listitem')).toHaveLength(12);
    expect(screen.getByRole('heading', { level: 1, name: 'Your mixes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/');
  });

  it('the Show all page holds every card even for a row drawn as a grid (Charts chip)', () => {
    shelf({ variant: 'c', fullRow: true }, 12, { layout: 'grid' });
    expect(screen.getAllByRole('listitem')).toHaveLength(12);
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });
});

describe('variant d (expand in place)', () => {
  it('shows one line of whole cards, Show more opens them all, Show less folds back', () => {
    rowWidth(1000);
    shelf({ variant: 'd' }, 8);
    const more = screen.getByRole('button', { name: 'Show more' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    fireEvent.click(more);
    expect(screen.getAllByRole('listitem')).toHaveLength(8);
    const less = screen.getByRole('button', { name: 'Show less' });
    expect(less).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('list')).toHaveClass('grid');
    fireEvent.click(less);
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });

  it('has nothing to show more of when every card fits', () => {
    rowWidth(1000);
    shelf({ variant: 'd' }, 5);
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });
});

describe('today and the phone are untouched by the switch', () => {
  it('today keeps the clickable edge fades and no titled arrows', () => {
    shelf({ variant: 'today' }, 10);
    expect(screen.getByRole('button', { name: 'Scroll right' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Scroll Your mixes/ })).toBeNull();
  });

  it('a phone row ignores the variant', () => {
    const tiles: ReactNode = [<div key="a">A</div>, <div key="b">B</div>];
    for (const variant of ['a', 'b', 'd'] as const) {
      const { unmount } = render(
        <RowNavProvider value={{ variant }}>
          <RowShelf title="Recently played">{tiles}</RowShelf>
        </RowNavProvider>,
      );
      expect(screen.getByRole('list')).toHaveClass('overflow-x-auto', 'snap-x');
      expect(screen.queryByRole('button')).toBeNull();
      unmount();
    }
  });
});

describe('variant c on a phone', () => {
  const phone = (n: number, nav: RowNav = { variant: 'c' }, props: Partial<ComponentProps<typeof RowShelf>> = {}) =>
    render(
      <RowNavProvider value={nav}>
        <RowShelf title="Your mixes" rowKey="mixes" {...props}>
          {Array.from({ length: n }, (_, i) => (
            <div key={i}>{`tile ${i}`}</div>
          ))}
        </RowShelf>
      </RowNavProvider>,
    );

  it('shows exactly two whole cards and no sideways scroll', () => {
    phone(7);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('list')).toHaveClass('grid', 'grid-cols-2');
    expect(screen.getByRole('list')).not.toHaveClass('overflow-x-auto');
  });

  it('has Show all only past two cards, linking to the row page', () => {
    const { unmount } = phone(3);
    expect(screen.getByRole('link', { name: 'Show all' })).toHaveAttribute('href', '/?homerows=c&row=mixes');
    unmount();
    phone(2);
    expect(screen.queryByRole('link', { name: 'Show all' })).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('the row page lists every card in two columns under a Back button', () => {
    phone(7, { variant: 'c', fullRow: true });
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    expect(screen.getByRole('list')).toHaveClass('grid-cols-2');
    expect(screen.getByRole('heading', { level: 1, name: 'Your mixes' })).toBeInTheDocument();
    expect(document.querySelector('[data-row-full]')).not.toBeNull();
  });

  it('a filter chip grid stays a grid with every card', () => {
    phone(5, { variant: 'c' }, { layout: 'grid' });
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
  });
});
