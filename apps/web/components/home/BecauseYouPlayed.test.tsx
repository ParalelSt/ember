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

describe('BecauseYouPlayed, wide (the desktop hero)', () => {
  const wide = { ...base, variant: 'wide' as const };

  it('is one card across the width: big art on the left, eyebrow, title, byline and four songs with durations', () => {
    const { container } = render(<BecauseYouPlayed {...wide} seedArtist="Seed" tracks={tracks(6)} />);
    const card = container.querySelector('[data-hero="wide"]') as HTMLElement;
    expect(card).toHaveClass('flex', 'rounded-[14px]');
    const art = card.querySelector('[data-hero-art]') as HTMLElement;
    expect(art).toHaveClass('w-[min(290px,38%)]');
    expect(art.querySelector('img')).toHaveAttribute('src', '/art/0.jpg');
    // The section's title is the card's ember eyebrow too.
    const eyebrows = screen.getAllByText('Because you played "X"');
    expect(eyebrows.some((e) => e.classList.contains('text-ember'))).toBe(true);
    expect(screen.getByRole('heading', { level: 3, name: 'Song 0' })).toHaveClass('text-[30px]');
    expect(screen.getByText('Artist 0 · More like Seed')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      'Song 1Artist 11:40',
      'Song 2Artist 21:40',
      'Song 3Artist 31:40',
      'Song 4Artist 41:40',
    ]);
    // 6 songs, the card holds 5.
    expect(screen.getByRole('link', { name: 'Show all' })).toHaveAttribute('href', '/?focus=recommended');
  });

  it('plays the list from the top, a row from that song, and toggles the current one', () => {
    const onPlay = vi.fn();
    const onToggle = vi.fn();
    const list = tracks(5);
    const { rerender } = render(<BecauseYouPlayed {...wide} onPlay={onPlay} onToggle={onToggle} tracks={list} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play these songs' }));
    expect(onPlay).toHaveBeenLastCalledWith(list[0], list);
    fireEvent.click(screen.getByText('Song 3'));
    expect(onPlay).toHaveBeenLastCalledWith(list[3], list);
    rerender(<BecauseYouPlayed {...wide} onPlay={onPlay} onToggle={onToggle} tracks={list} currentId={list[3].id} isPlaying />);
    expect(screen.getByText('Song 3')).toHaveClass('text-ember');
    fireEvent.click(screen.getByText('Song 3'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledTimes(2);
  });

  it('has no Show all when it holds every song, and a tall placeholder while loading', () => {
    const { rerender } = render(<BecauseYouPlayed {...wide} tracks={tracks(5)} />);
    expect(screen.queryByRole('link', { name: 'Show all' })).toBeNull();
    rerender(<BecauseYouPlayed {...wide} tracks={[]} loading />);
    expect(screen.getByTestId('hero-skeleton')).toHaveClass('h-[290px]');
  });
});
