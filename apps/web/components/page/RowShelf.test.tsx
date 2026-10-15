import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
