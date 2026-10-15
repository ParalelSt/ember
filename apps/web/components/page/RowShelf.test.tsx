import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { RowShelf } from './RowShelf';

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
    for (const item of items) expect(item).toHaveClass('w-36', 'shrink-0', 'snap-start');
  });

  it('truncates the title to one line and keeps "Show all" small, normal case and on one line', () => {
    render(
      <RowShelf title={'Because you played "A Very Long Song Title That Goes On"'} showAllHref="/?focus=recommended">
        <div key="a">A</div>
      </RowShelf>,
    );
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading).toHaveClass('truncate', 'min-w-0', 'text-[22px]', 'font-bold');
    const link = screen.getByRole('link', { name: 'Show all' });
    expect(link).toHaveAttribute('href', '/?focus=recommended');
    expect(link).toHaveClass('whitespace-nowrap', 'shrink-0', 'text-muted-foreground');
    expect(link).not.toHaveClass('uppercase');
    expect(link.textContent).toBe('Show all');
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
