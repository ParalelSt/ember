import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// A transfer has no playlist of its own, so its ring hangs on the Liked
// songs row instead (lib/import/nav.ts, LIKED_NAV_KEY).

vi.mock('next/link', () => ({ default: ({ children, ...rest }: ComponentProps<'a'>) => <a {...rest}>{children}</a> }));
const { CollectionNavList } = await import('./CollectionNavList');

const ITEMS = [
  { label: 'Liked songs', href: '/library/liked', icon: 'heart' as const },
  { label: 'Recently played', href: '/library/recent', icon: 'clock' as const },
];

describe('CollectionNavList', () => {
  it('without a transfer: plain links, no ring', () => {
    render(<CollectionNavList items={ITEMS} activePath="/library/liked" />);
    expect(screen.getByRole('link', { name: 'Liked songs' })).toBeInTheDocument();
    expect(screen.queryByTestId('import-nav-row')).toBeNull();
  });

  it('a running transfer puts its progress on Liked songs', () => {
    render(
      <CollectionNavList
        items={[{ ...ITEMS[0], importState: { kind: 'importing', done: 240, total: 1200 } }, ITEMS[1]]}
        activePath="/"
      />,
    );
    const row = screen.getByTestId('import-nav-row');
    expect(row).toHaveAttribute('data-import', 'importing');
    expect(row).toHaveTextContent('Liked songs');
    expect(row).toHaveTextContent('240 of 1200');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '240');
  });

  it('songs left to check say so', () => {
    render(<CollectionNavList items={[{ ...ITEMS[0], importState: { kind: 'review', count: 61 } }]} activePath="/" />);
    expect(screen.getByTestId('import-nav-row')).toHaveTextContent('61 to review');
  });
});
