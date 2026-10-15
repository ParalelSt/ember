import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));

const { CollectionCard } = await import('./CollectionCard');

const base = { title: 'Road trip', subtitle: 'Playlist', href: '/playlist/p1', cover: { src: null, icon: null }, size: 'md' as const };

describe('CollectionCard', () => {
  it('a playlist shared with you shows a "Shared by" pill with the owner\'s face, not the people mark', () => {
    render(<CollectionCard {...base} subtitle="Shared by Olga" shared sharedBy={{ name: 'Olga', avatarUrl: null }} />);
    const badge = screen.getByTestId('shared-by');
    expect(badge).toHaveTextContent('OShared by Olga');
    expect(screen.queryByTestId('shared-badge')).toBeNull();
    // The pill says it once: no second "Shared by Olga" line under it.
    expect(screen.getAllByText(/Shared by/)).toHaveLength(1);
  });

  it('your own collaborative playlist keeps the people mark and its subtitle', () => {
    render(<CollectionCard {...base} subtitle="Collaborative" shared />);
    expect(screen.getByTestId('shared-badge')).toBeInTheDocument();
    expect(screen.queryByTestId('shared-by')).toBeNull();
    expect(screen.getByText('Collaborative')).toBeInTheDocument();
  });
});

describe('CollectionCard tile (the phone Home "Your playlists" row)', () => {
  it('is a bare link tile: square cover, a two-line title and one muted line', () => {
    const title = 'A Playlist Name So Long It Would Never Fit On One Line Of A Phone Tile';
    render(<CollectionCard {...base} title={title} variant="tile" />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/playlist/p1');
    expect(link).not.toHaveClass('bg-card');
    expect(screen.getByText(title)).toHaveClass('line-clamp-2', 'break-words', 'min-w-0');
    expect(screen.getByText('Playlist')).toHaveClass('truncate', 'text-muted-foreground');
  });

  it('a shared playlist says whose it is in its one line, without the pill', () => {
    render(<CollectionCard {...base} subtitle="Shared by Olga" shared sharedBy={{ name: 'Olga', avatarUrl: null }} variant="tile" />);
    expect(screen.getByText('Shared by Olga')).toBeInTheDocument();
    expect(screen.queryByTestId('shared-by')).toBeNull();
  });
});

describe('CollectionCard, desktop tile (tile-lg)', () => {
  it('is a bare 180px-row tile: cover, a 15px two-line name that opens it, a 13px muted line', () => {
    render(<CollectionCard {...base} variant="tile-lg" subtitle="Playlist · Aron" />);
    const name = screen.getByRole('link', { name: 'Road trip' });
    expect(name).toHaveAttribute('href', '/playlist/p1');
    expect(name).toHaveClass('text-[15px]', 'font-bold', 'line-clamp-2');
    expect(screen.getByText('Playlist · Aron')).toHaveClass('text-[13px]', 'text-muted-foreground');
    // One link in the tab order; the cover's own link is hidden from it.
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('a play button slides up on hover and plays the collection', () => {
    const onPlay = vi.fn();
    render(<CollectionCard {...base} variant="tile-lg" onPlay={onPlay} />);
    const play = screen.getByRole('button', { name: 'Play Road trip' });
    expect(play).toHaveClass('opacity-0', 'translate-y-2', 'group-hover:opacity-100', 'group-hover:translate-y-0');
    // Not inside a link: pressing it plays, it does not open the page.
    expect(play.closest('a')).toBeNull();
    fireEvent.click(play);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('keeps the button up as Pause while the collection plays', () => {
    render(<CollectionCard {...base} variant="tile-lg" onPlay={() => {}} playing />);
    expect(screen.getByRole('button', { name: 'Pause' })).toHaveClass('opacity-100');
  });

  it('has no play button without onPlay', () => {
    render(<CollectionCard {...base} variant="tile-lg" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
