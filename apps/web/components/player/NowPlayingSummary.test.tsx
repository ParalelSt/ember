import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { NowPlayingSummary } from './NowPlayingSummary';
import type { Track } from '@/types/track';

// next/link reads the app router context, which no test renders, and next
// itself is hoisted to the repo root where it resolves React 18.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

function makeTrack(over: Partial<Track> = {}): Track {
  return {
    id: 'youtube:a1',
    source: 'youtube',
    sourceId: 'a1',
    title: 'Midnight Drive',
    artist: 'The Nulls',
    artistId: 'art1',
    album: 'Night Shift',
    albumId: 'alb1',
    durationSec: 191,
    artworkUrl: 'https://example.com/a.jpg',
    streamUrl: '',
    ...over,
  };
}

describe('NowPlayingSummary', () => {
  it('shows the title, the artwork and a link to the artist', () => {
    const { container } = render(<NowPlayingSummary track={makeTrack()} size="sm" />);
    expect(screen.getByText('Midnight Drive')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'The Nulls' })).toHaveAttribute('href', '/artist/art1');
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://example.com/a.jpg');
  });

  it('renders the artist as plain text when asked not to link it', () => {
    render(<NowPlayingSummary track={makeTrack()} size="sm" artistLink={false} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('The Nulls')).toBeInTheDocument();
  });

  it('renders the artist as plain text when the track has no artist page', () => {
    render(<NowPlayingSummary track={makeTrack({ artistId: null })} size="sm" />);
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('opens on a tap of the cluster, but not when the artist link is followed', () => {
    const onOpen = vi.fn();
    render(<NowPlayingSummary track={makeTrack()} size="sm" onOpen={onOpen} />);

    fireEvent.click(screen.getByText('Midnight Drive'));
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('link', { name: 'The Nulls' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('tells the caller when the artist link is followed, so a view can close itself', () => {
    const onArtistNavigate = vi.fn();
    render(<NowPlayingSummary track={makeTrack()} size="lg" onArtistNavigate={onArtistNavigate} />);
    fireEvent.click(screen.getByRole('link', { name: 'The Nulls' }));
    expect(onArtistNavigate).toHaveBeenCalledTimes(1);
  });

  it('leaves out the artwork at size lg, where the view draws its own', () => {
    const { container } = render(<NowPlayingSummary track={makeTrack()} size="lg" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Midnight Drive')).toBeInTheDocument();
  });

  it('falls back to a placeholder title with nothing playing', () => {
    const { container } = render(<NowPlayingSummary track={null} size="sm" />);
    expect(screen.getByText('Nothing playing')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('draws no artwork box for a track without art', () => {
    const { container } = render(<NowPlayingSummary track={makeTrack({ artworkUrl: null })} size="sm" />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('Midnight Drive')).toBeInTheDocument();
  });
});
