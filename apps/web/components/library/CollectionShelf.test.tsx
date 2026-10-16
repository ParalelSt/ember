import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));

const { CollectionShelf } = await import('./CollectionShelf');

const item = (n: number) => ({ title: `List ${n}`, subtitle: 'Playlist', href: `/playlist/${n}`, cover: { src: null, icon: null } });

describe('CollectionShelf', () => {
  it('is the standard grid: 3 per row on a phone, 6 per row on desktop', () => {
    render(<CollectionShelf title="Playlists" items={[1, 2, 3].map(item)} />);
    const grid = document.querySelector('[data-library-grid]')!;
    expect(grid).toHaveClass('grid', 'grid-cols-3', 'md:grid-cols-6');
    expect(grid.children).toHaveLength(3);
  });

  it('shows the empty node instead of a grid', () => {
    render(<CollectionShelf title="Playlists" items={[]} empty={<p>No playlists yet</p>} />);
    expect(screen.getByText('No playlists yet')).toBeInTheDocument();
    expect(document.querySelector('[data-library-grid]')).toBeNull();
  });

  it('a playlist without art or four song covers gets the neutral note tile', () => {
    render(<CollectionShelf title="Playlists" items={[item(1)]} />);
    expect(document.querySelector('[data-neutral-cover] svg')).not.toBeNull();
  });
});
