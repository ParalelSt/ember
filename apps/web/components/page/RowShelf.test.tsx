import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ROW_MAX, RowShelf } from './RowShelf';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

describe('RowShelf (the phone Home row)', () => {
  it('lays its tiles out in one sideways-scrolling row, edge to edge, with no bar', () => {
    render(
      <RowShelf title="Recently played">
        <div key="a">A</div>
        <div key="b">B</div>
        <div key="c">C</div>
      </RowShelf>,
    );
    const list = screen.getByRole('list');
    // One flex row that scrolls sideways (never wraps into a grid), snaps to
    // a tile, hides its scrollbar and bleeds into the page gutter.
    for (const cls of ['flex', 'overflow-x-auto', 'snap-x', 'snap-mandatory', 'scrollbar-none', '-mx-page', 'px-page']) {
      expect(list).toHaveClass(cls);
    }
    expect(list).not.toHaveClass('grid');
    expect(list).not.toHaveClass('flex-wrap');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    // A fixed width that does not shrink: a long name cannot widen a tile.
    // About 140px, Spotify's Recents tile.
    for (const item of items) expect(item).toHaveClass('w-[140px]', 'shrink-0', 'snap-start');
  });

  it('wraps the 22px bold title to at most two lines and keeps "Show all" muted, bold and on one line', () => {
    render(
      <RowShelf title={'Because you played "A Very Long Song Title That Goes On"'} showAllHref="/?focus=recommended">
        {Array.from({ length: ROW_MAX + 1 }, (_, i) => <div key={i}>{i}</div>)}
      </RowShelf>,
    );
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveClass('line-clamp-2', 'break-words', 'min-w-0', 'text-[22px]', 'font-bold');
    expect(heading).not.toHaveClass('truncate');
    const link = screen.getByRole('link', { name: 'Show all' });
    expect(link).toHaveAttribute('href', '/?focus=recommended');
    expect(link).toHaveClass('whitespace-nowrap', 'shrink-0', 'text-muted-foreground', 'font-bold');
    expect(link).not.toHaveClass('uppercase');
    expect(link.textContent).toBe('Show all');
  });

  it('shows at most ROW_MAX tiles, and Show all only when it holds more than it shows', () => {
    const tiles = (n: number) => Array.from({ length: n }, (_, i) => <div key={i}>{i}</div>);
    const { rerender } = render(<RowShelf title="Popular now" showAllHref="/?focus=trending">{tiles(ROW_MAX)}</RowShelf>);
    expect(screen.getAllByRole('listitem')).toHaveLength(ROW_MAX);
    expect(screen.queryByRole('link', { name: 'Show all' })).toBeNull();
    rerender(<RowShelf title="Popular now" showAllHref="/?focus=trending">{tiles(ROW_MAX + 1)}</RowShelf>);
    expect(screen.getAllByRole('listitem')).toHaveLength(ROW_MAX);
    expect(screen.getByRole('link', { name: 'Show all' })).toBeInTheDocument();
    rerender(<RowShelf title="Popular now" showAllHref="/?focus=trending" limit={2}>{tiles(3)}</RowShelf>);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Show all' })).toBeInTheDocument();
  });

  it('lines the first tile up with the page gutter while the row runs edge to edge', () => {
    render(<RowShelf title="Recently played"><div key="a">A</div></RowShelf>);
    const list = screen.getByRole('list');
    // -mx-page pulls the row out to the screen edges; px-page puts the
    // first tile back on the gutter; scroll-px-page keeps snapping there.
    expect(list).toHaveClass('-mx-page', 'px-page', 'scroll-px-page', 'snap-x');
  });

  it('has no Show all without an href', () => {
    render(
      <RowShelf title="Friends are listening to">
        <div key="a">A</div>
      </RowShelf>,
    );
    expect(screen.queryByRole('link', { name: 'Show all' })).toBeNull();
  });

  it('renders nothing with no tiles (an empty section hides)', () => {
    const { container } = render(<RowShelf title="Your playlists">{[]}</RowShelf>);
    expect(container).toBeEmptyDOMElement();
  });
});

/** jsdom lays nothing out: give the row the sizes a browser would. */
function size(el: HTMLElement, { client, scroll, left = 0 }: { client: number; scroll: number; left?: number }) {
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: client });
  Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scroll });
  el.scrollLeft = left;
}

describe('RowShelf, desktop (the owner\'s "arrows" and "t180" picks)', () => {
  const tiles = (n: number) => Array.from({ length: n }, (_, i) => <div key={i}>{i}</div>);

  it('scrolls sideways inside the gutter with 180px tiles and a 24px bold title', () => {
    render(<RowShelf variant="desktop" title="Recently played">{tiles(3)}</RowShelf>);
    const list = screen.getByRole('list');
    expect(list).toHaveClass('flex', 'overflow-x-auto', 'scrollbar-none');
    // No bleed: the first tile sits on the content area's left edge.
    expect(list.className).not.toMatch(/-mx-|px-page/);
    for (const item of within(list).getAllByRole('listitem')) expect(item).toHaveClass('w-[180px]', 'shrink-0');
    expect(screen.getByRole('heading', { level: 2 })).toHaveClass('text-2xl', 'font-bold', 'line-clamp-2');
  });

  it('puts < and > in the header, left of Show all, and Show all only when there is more', () => {
    const { rerender } = render(<RowShelf variant="desktop" title="Popular now" showAllHref="/?focus=trending">{tiles(ROW_MAX)}</RowShelf>);
    expect(screen.queryByRole('link', { name: 'Show all' })).toBeNull();
    rerender(<RowShelf variant="desktop" title="Popular now" showAllHref="/?focus=trending">{tiles(ROW_MAX + 1)}</RowShelf>);
    expect(screen.getAllByRole('listitem')).toHaveLength(ROW_MAX);
    const controls = screen.getByRole('link', { name: 'Show all' }).parentElement!;
    expect([...controls.children].map((c) => c.getAttribute('aria-label') ?? c.textContent)).toEqual([
      'Scroll left',
      'Scroll right',
      'Show all',
    ]);
  });

  it('shows the arrows on row hover, always on touch screens', () => {
    render(<RowShelf variant="desktop" title="Popular now">{tiles(3)}</RowShelf>);
    expect(screen.getByRole('region', { name: 'Popular now' })).toHaveClass('group/row');
    const right = screen.getByRole('button', { name: 'Scroll right' });
    expect(right).toHaveClass('opacity-0', 'group-hover/row:opacity-100', '[@media(hover:none)]:opacity-100');
  });

  it('scrolls by about 80% of the row width and hides each arrow at its end', () => {
    render(<RowShelf variant="desktop" title="Popular now">{tiles(10)}</RowShelf>);
    const list = screen.getByRole('list');
    const scrollBy = vi.fn();
    list.scrollBy = scrollBy as unknown as typeof list.scrollBy;
    const left = () => screen.getByRole('button', { name: 'Scroll left' });
    const right = () => screen.getByRole('button', { name: 'Scroll right' });

    // At the start: nothing to the left.
    size(list, { client: 500, scroll: 1960, left: 0 });
    fireEvent.scroll(list);
    expect(left()).toBeDisabled();
    expect(left()).toHaveClass('disabled:invisible');
    expect(right()).toBeEnabled();

    fireEvent.click(right());
    expect(scrollBy).toHaveBeenLastCalledWith({ left: 400, behavior: 'smooth' });

    // In the middle: both ways.
    size(list, { client: 500, scroll: 1960, left: 400 });
    fireEvent.scroll(list);
    expect(left()).toBeEnabled();
    expect(right()).toBeEnabled();
    fireEvent.click(left());
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -400, behavior: 'smooth' });

    // At the end: nothing to the right.
    size(list, { client: 500, scroll: 1960, left: 1460 });
    fireEvent.scroll(list);
    expect(left()).toBeEnabled();
    expect(right()).toBeDisabled();
  });

  it('has no arrows to press when the row fits', () => {
    render(<RowShelf variant="desktop" title="Your playlists">{tiles(2)}</RowShelf>);
    expect(screen.getByRole('button', { name: 'Scroll left' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Scroll right' })).toBeDisabled();
  });
});

describe('RowShelf, desktop mouse drag', () => {
  const setup = () => {
    const onClick = vi.fn();
    render(
      <RowShelf variant="desktop" title="Popular now">
        {[0, 1, 2].map((i) => (
          <button key={i} type="button" onClick={onClick}>{`tile ${i}`}</button>
        ))}
      </RowShelf>,
    );
    const list = screen.getByRole('list');
    list.scrollLeft = 100;
    return { list, onClick, tile: screen.getByText('tile 1') };
  };

  it('a drag past 6px scrolls the row, shows a grabbing cursor and swallows the click on release', () => {
    const { list, onClick, tile } = setup();
    fireEvent.mouseDown(tile, { button: 0, clientX: 300 });
    fireEvent.mouseMove(window, { clientX: 298 });
    expect(list.scrollLeft).toBe(100);
    fireEvent.mouseMove(window, { clientX: 250 });
    expect(list.scrollLeft).toBe(150);
    expect(list.style.cursor).toBe('grabbing');
    fireEvent.mouseUp(window, { clientX: 250 });
    fireEvent.click(tile);
    expect(onClick).not.toHaveBeenCalled();
    expect(list.style.cursor).toBe('');
    // The next, plain click goes through.
    fireEvent.click(tile);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('a plain click (press and release in place) still activates the tile', () => {
    const { onClick, tile } = setup();
    fireEvent.mouseDown(tile, { button: 0, clientX: 300 });
    fireEvent.mouseMove(window, { clientX: 303 });
    fireEvent.mouseUp(window, { clientX: 303 });
    fireEvent.click(tile);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
