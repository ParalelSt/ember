import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
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
    expect(screen.getByText('Gym').closest('a')).not.toHaveAttribute('data-testid');
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
