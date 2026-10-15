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
  { label: 'Uploads', href: '/library/uploads', icon: 'upload' as const },
];

describe('CollectionNavList', () => {
  it('without a transfer: plain links, no ring', () => {
    render(<CollectionNavList items={ITEMS} activePath="/library/liked" />);
    expect(screen.getByRole('link', { name: /^Liked songs/ })).toBeInTheDocument();
    expect(screen.queryByTestId('import-nav-row')).toBeNull();
  });

  it('draws 32px covers with plain colored glyph fallbacks and omits unknown counts', () => {
    render(<CollectionNavList items={ITEMS} activePath="/" />);
    const liked = screen.getByRole('link', { name: /^Liked songs/ });
    expect(liked.querySelector('[data-liked-cover]')).not.toBeNull();
    const recent = screen.getByRole('link', { name: /^Recently played/ });
    expect(liked.querySelector('[data-liked-cover]')).toHaveClass('size-8', 'rounded-[4px]');
    expect(liked).toHaveTextContent('Playlist');
    for (const [name, kind, subtitle] of [['Recently played', 'recent', 'Auto playlist'], ['Uploads', 'uploads', 'Uploads']]) {
      const row = screen.getByRole('link', { name: new RegExp(`^${name}`) });
      const cover = row.querySelector(`[data-library-cover="${kind}"]`);
      expect(cover).toHaveClass('size-8', 'rounded-[4px]');
      expect(cover).toHaveAttribute('data-look', 'plain');
      expect(cover?.querySelector('[data-glyph] svg')).not.toBeNull();
      expect(row).toHaveTextContent(subtitle);
      expect(row).not.toHaveTextContent('songs');
    }
    expect(recent).toHaveTextContent('Auto playlist');
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

it('uses supplied counts and system artwork, keeping navigation and truncation', () => {
  const onNavigate = vi.fn();
  render(<CollectionNavList activePath="/library/recent" onNavigate={onNavigate} items={[
    { ...ITEMS[0], count: 0 },
    { ...ITEMS[1], count: 4, artworks: ['/a', '/b', '/c', '/d'] },
    { ...ITEMS[2], count: 1, artworks: ['/upload'] },
  ]} />);
  expect(screen.getByText('Playlist · 0 songs')).toBeInTheDocument();
  expect(screen.getByText('Auto playlist · 4 songs')).toBeInTheDocument();
  expect(screen.getByText('Uploads · 1 song')).toBeInTheDocument();
  const recent = screen.getByRole('link', { name: /^Recently played/ });
  expect(recent).toHaveClass('bg-sidebar-accent', 'px-cluster', 'py-1.5', 'gap-row');
  expect(recent.querySelectorAll('[data-mosaic] img')).toHaveLength(4);
  expect(recent.querySelector('[data-badge]')).not.toBeNull();
  expect(screen.getByText('Recently played')).toHaveClass('truncate', 'text-[14.5px]');
  const uploads = screen.getByRole('link', { name: /^Uploads/ });
  expect(uploads.querySelector('img')).toHaveAttribute('src', '/upload');
  expect(uploads.querySelector('[data-badge]')).not.toBeNull();
  recent.click();
  expect(onNavigate).toHaveBeenCalledOnce();
});
