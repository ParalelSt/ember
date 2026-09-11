import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TrackCard } from './TrackCard';
import type { Track } from '@/types/track';

// next/link reads the app router context and resolves the repo root's
// React 18 through next's dist, so component tests render a plain anchor
// instead (see components/OnlineOnly.test.tsx).
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const track: Track = {
  id: 'youtube:a1',
  source: 'youtube',
  sourceId: 'a1',
  title: 'Midnight Drive',
  artist: 'The Nulls',
  artistId: 'art1',
  album: 'Night Shift',
  albumId: 'alb1',
  durationSec: 191,
  artworkUrl: 'https://example.test/a1.jpg',
  streamUrl: '',
};

describe('TrackCard', () => {
  it('renders the title and a link to the artist', () => {
    render(<TrackCard track={track} onActivate={() => {}} />);
    expect(screen.getByText('Midnight Drive')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'The Nulls' })).toHaveAttribute('href', '/artist/art1');
  });

  it('renders the artist as plain text when there is no artist id', () => {
    render(<TrackCard track={{ ...track, artistId: null }} onActivate={() => {}} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('The Nulls')).toBeInTheDocument();
  });

  it('shows Play until the card is both active and playing', () => {
    const { rerender } = render(<TrackCard track={track} onActivate={() => {}} />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();

    rerender(<TrackCard track={track} active playing={false} onActivate={() => {}} />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();

    rerender(<TrackCard track={track} active playing onActivate={() => {}} />);
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('calls onActivate from the card and from the button', () => {
    const onActivate = vi.fn();
    render(<TrackCard track={track} onActivate={onActivate} />);

    fireEvent.click(screen.getByText('Midnight Drive'));
    expect(onActivate).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    // The button stops propagation, so the card's own onClick must not
    // fire a second time for one press.
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('does not activate when the artist link is clicked', () => {
    const onActivate = vi.fn();
    render(<TrackCard track={track} onActivate={onActivate} />);
    fireEvent.click(screen.getByRole('link', { name: 'The Nulls' }));
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('renders the fallback node when the track has no artwork', () => {
    const fallback = <span data-testid="artwork-fallback">No Artwork</span>;
    render(
      <TrackCard
        track={{ ...track, artworkUrl: null }}
        onActivate={() => {}}
        artworkFallback={fallback}
      />
    );
    expect(screen.getByTestId('artwork-fallback')).toBeInTheDocument();
  });
});
