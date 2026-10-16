import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BecauseYouPlayed } from './BecauseYouPlayed';
import type { Track } from '@/types/track';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const tracks = (n: number): Track[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `youtube:r${i}`,
    source: 'youtube' as const,
    sourceId: `r${i}`,
    title: `Song ${i}`,
    artist: `Artist ${i}`,
    artistId: null,
    album: null,
    albumId: null,
    durationSec: 100,
    artworkUrl: `/art/${i}.jpg`,
    streamUrl: '',
  }));

const base = { title: 'Because you played "X"', onPlay: vi.fn(), onToggle: vi.fn(), showAllHref: '/?focus=recommended' };

describe('BecauseYouPlayed', () => {
  it('is a 178px picture card with a dark gradient and the first song\'s art', () => {
    const { container } = render(<BecauseYouPlayed {...base} seedArtist="Seed" tracks={tracks(4)} />);
    const art = container.querySelector('[data-hero] > div') as HTMLElement;
    expect(art).toHaveClass('h-[178px]');
    expect(art.querySelector('img')).toHaveAttribute('src', '/art/0.jpg');
    expect(art.querySelector('.bg-gradient-to-b')).not.toBeNull();
    expect(screen.getByText('Artist 0 · More like Seed')).toBeInTheDocument();
  });

  it('has no Show all when the card already holds every song', () => {
    render(<BecauseYouPlayed {...base} tracks={tracks(4)} />);
    expect(screen.queryByRole('link', { name: 'Show all' })).toBeNull();
    // No seed: just the artist.
    expect(screen.getByText('Artist 0')).toBeInTheDocument();
  });

  it('shows a placeholder while loading and nothing once it ends up empty', () => {
    const { rerender, container } = render(<BecauseYouPlayed {...base} tracks={[]} loading />);
    expect(screen.getByTestId('hero-skeleton')).toHaveClass('h-[178px]');
    rerender(<BecauseYouPlayed {...base} tracks={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('works with a single suggestion: the card, no rows', () => {
    render(<BecauseYouPlayed {...base} tracks={tracks(1)} />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Play these songs' })).toBeInTheDocument();
  });
});
