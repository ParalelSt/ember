import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AlbumShelf } from './AlbumShelf';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));

describe('AlbumShelf', () => {
  const albums = Array.from({ length: 14 }, (_, i) => ({
    browseId: `MPREb_${i}/x`, title: `Album ${i}`, year: i === 0 ? undefined : 2000 + i, thumbnails: [],
  }));

  it('lists every album as a link tile, with no Show all', () => {
    render(<AlbumShelf title="Discography" albums={albums as never} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(14);
    expect(screen.queryByText('Show all')).toBeNull();
    expect(screen.getByRole('link', { name: /Album 3/ }).getAttribute('href')).toBe(`/album/${encodeURIComponent('MPREb_3/x')}`);
    expect(screen.getByText('2003')).toBeTruthy();
  });
});
