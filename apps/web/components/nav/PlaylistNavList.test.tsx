import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PlaylistNavList } from './PlaylistNavList';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe('PlaylistNavList import states', () => {
  it('a playlist being imported shows "18 of 42" and a progress ring', () => {
    render(
      <PlaylistNavList
        authed
        activePath="/playlist/p1"
        items={[
          { id: 'p1', name: 'Late night drive', href: '/playlist/p1', importState: { kind: 'importing', done: 18, total: 42 } },
          { id: 'p2', name: 'Gym', href: '/playlist/p2' },
        ]}
      />,
    );
    const row = screen.getByTestId('import-nav-row');
    expect(row).toHaveTextContent('Late night drive');
    expect(row).toHaveTextContent('18 of 42');
    const ring = within(row).getByRole('progressbar');
    expect(ring).toHaveAttribute('aria-valuenow', '18');
    expect(ring).toHaveAttribute('aria-valuemax', '42');
    expect(row.className).toContain('bg-sidebar-accent');
    expect(screen.getByText('Gym').closest('a')).toHaveAttribute('data-testid', 'playlist-nav-row');
  });

  it('once done it says how many songs wait for a look', () => {
    render(
      <PlaylistNavList authed items={[{ id: 'p1', name: 'Mix', href: '/playlist/p1', importState: { kind: 'review', count: 4 } }]} />,
    );
    expect(screen.getByTestId('import-nav-row')).toHaveTextContent('4 to review');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('paused and failed read as such', () => {
    render(
      <PlaylistNavList
        authed
        items={[
          { id: 'a', name: 'A', href: '/a', importState: { kind: 'paused', done: 8, total: 40 } },
          { id: 'b', name: 'B', href: '/b', importState: { kind: 'failed' } },
        ]}
      />,
    );
    const [a, b] = screen.getAllByTestId('import-nav-row');
    expect(a).toHaveTextContent('Paused');
    expect(b).toHaveTextContent('Import failed');
  });
});

describe('PlaylistNavList shared playlists', () => {
  it('a collaborative playlist wears a people mark that says whose it is', () => {
    render(
      <PlaylistNavList
        authed
        items={[
          { id: 'p1', name: 'Road trip', href: '/playlist/p1', sharedLabel: 'Shared by Olga' },
          { id: 'p2', name: 'Gym', href: '/playlist/p2' },
        ]}
      />,
    );
    expect(screen.getByTestId('nav-shared')).toHaveAttribute('aria-label', 'Shared by Olga');
    expect(screen.getByRole('link', { name: /Road trip/ })).toHaveAttribute('title', 'Road trip, Shared by Olga');
    expect(screen.getAllByTestId('nav-shared')).toHaveLength(1);
  });
});

const many = Array.from({ length: 30 }, (_, i) => ({ id: `p${i}`, name: `Playlist number ${i}`, href: `/playlist/p${i}` }));

describe('PlaylistNavList rows', () => {
  it('30 rows are fixed-height, never shrink and only the name truncates', () => {
    render(<PlaylistNavList authed items={many} />);
    const rows = screen.getAllByTestId('playlist-nav-row');
    expect(rows).toHaveLength(30);
    for (const row of rows) {
      expect(row.className).toContain('shrink-0');
      expect(row.className).toContain('min-h-11');
      expect(row.className).not.toMatch(/(^|\s)truncate(\s|$)/);
      expect(row.querySelector('span.truncate')).not.toBeNull();
    }
  });

  it('shows a pin on pinned rows and reports taps', () => {
    const onOpen = vi.fn();
    const onNavigate = vi.fn();
    render(
      <PlaylistNavList authed onOpen={onOpen} onNavigate={onNavigate} onTogglePin={vi.fn()} items={[{ ...many[0], pinned: true }, many[1]]} />,
    );
    expect(screen.getAllByLabelText('Pinned')).toHaveLength(1);
    fireEvent.click(screen.getByText('Playlist number 1'));
    expect(onOpen).toHaveBeenCalledWith('p1');
    expect(onNavigate).toHaveBeenCalled();
  });

  it('right-click toggles the pin and does not open the playlist', () => {
    const onOpen = vi.fn();
    const onTogglePin = vi.fn();
    render(<PlaylistNavList authed onOpen={onOpen} onTogglePin={onTogglePin} items={many.slice(0, 2)} />);
    const row = screen.getByText('Playlist number 1').closest('a')!;
    fireEvent.contextMenu(row);
    expect(onTogglePin).toHaveBeenCalledWith('p1');
    fireEvent.click(row);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith('p1');
  });

  it('a long press toggles the pin', () => {
    vi.useFakeTimers();
    const onTogglePin = vi.fn();
    render(<PlaylistNavList authed onTogglePin={onTogglePin} items={many.slice(0, 1)} />);
    const row = screen.getByText('Playlist number 0').closest('a')!;
    fireEvent.pointerDown(row, { button: 0, clientX: 5, clientY: 5 });
    vi.advanceTimersByTime(600);
    expect(onTogglePin).toHaveBeenCalledWith('p0');
    vi.useRealTimers();
  });
});
