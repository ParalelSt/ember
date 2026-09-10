import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TrackRow } from './TrackRow';
import type { Track } from '@/types/track';

// next/link reads the app router context and pulls in next's own React
// copy, so component tests render a plain anchor instead (see
// components/OnlineOnly.test.tsx).
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

describe('TrackRow (list density)', () => {
  it('renders the title, album, duration and artist link', () => {
    render(<TrackRow track={track} index={2} />);
    expect(screen.getByText('Midnight Drive')).toBeInTheDocument();
    expect(screen.getByText('Night Shift')).toBeInTheDocument();
    expect(screen.getByText('3:11')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'The Nulls' })).toHaveAttribute('href', '/artist/art1');
  });

  it('hides the album text when showAlbum is false', () => {
    render(<TrackRow track={track} showAlbum={false} />);
    expect(screen.queryByText('Night Shift')).toBeNull();
  });

  it('shows the rank only when asked and only while the row is not active', () => {
    const { rerender } = render(<TrackRow track={track} index={4} />);
    expect(screen.queryByText('5')).toBeNull();

    rerender(<TrackRow track={track} index={4} showRank />);
    expect(screen.getByText('5')).toBeInTheDocument();

    rerender(<TrackRow track={track} index={4} showRank active />);
    expect(screen.queryByText('5')).toBeNull();
  });

  it('marks the active row and follows the playing state on the play cell', () => {
    const { container, rerender } = render(<TrackRow track={track} />);
    expect(container.firstElementChild?.className).not.toContain('text-ember');
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();

    rerender(<TrackRow track={track} active playing />);
    expect(container.firstElementChild?.className).toContain('text-ember');
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
  });

  it('plays from the play cell, and toggles instead when the row is active', () => {
    const onPlay = vi.fn();
    const onToggle = vi.fn();
    const { rerender } = render(<TrackRow track={track} onPlay={onPlay} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(onToggle).not.toHaveBeenCalled();

    rerender(<TrackRow track={track} active playing onPlay={onPlay} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('plays on a double click of the row', () => {
    const onPlay = vi.fn();
    const { container } = render(<TrackRow track={track} onPlay={onPlay} />);
    fireEvent.doubleClick(container.firstElementChild!);
    expect(onPlay).toHaveBeenCalledTimes(1);
  });

  it('stops an artist link click from reaching whatever contains the row', () => {
    // The row itself only listens for double clicks, so the guard is
    // checked against an enclosing click handler.
    const onPlay = vi.fn();
    const outer = vi.fn();
    render(
      <div onClick={outer}>
        <TrackRow track={track} onPlay={onPlay} />
      </div>,
    );

    fireEvent.click(screen.getByRole('link', { name: 'The Nulls' }));
    expect(outer).not.toHaveBeenCalled();
    expect(onPlay).not.toHaveBeenCalled();

    // A click on the title is not stopped: it plays and bubbles.
    fireEvent.click(screen.getByText('Midnight Drive'));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('shows the heart only with a liked flag and an onLike handler', () => {
    const onLike = vi.fn();
    const { rerender } = render(<TrackRow track={track} onLike={onLike} />);
    expect(screen.queryByRole('button', { name: /like/i })).toBeNull();

    rerender(<TrackRow track={track} liked={false} onLike={onLike} />);
    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    expect(onLike).toHaveBeenCalledTimes(1);

    rerender(<TrackRow track={track} liked onLike={onLike} />);
    expect(screen.getByRole('button', { name: 'Unlike' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the remove button only with an onRemove handler', () => {
    const onRemove = vi.fn();
    const { rerender } = render(<TrackRow track={track} />);
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();

    rerender(<TrackRow track={track} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('renders the trailing slot', () => {
    render(<TrackRow track={track} trailing={<button type="button">Menu</button>} />);
    expect(screen.getByRole('button', { name: 'Menu' })).toBeInTheDocument();
  });

  it('renders no artwork box for a track without art', () => {
    const { container } = render(<TrackRow track={{ ...track, artworkUrl: null }} />);
    expect(container.querySelector('img')).toBeNull();
  });
});

describe('TrackRow (compact density)', () => {
  it('omits the rank, the album and the play cell', () => {
    render(<TrackRow track={track} index={4} showRank density="compact" onPlay={() => {}} />);
    expect(screen.queryByText('5')).toBeNull();
    expect(screen.queryByText('Night Shift')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
  });

  it('plays on a single click and renders the artist as plain text', () => {
    const onPlay = vi.fn();
    const { container } = render(<TrackRow track={track} density="compact" onPlay={onPlay} />);
    fireEvent.click(container.firstElementChild!);
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('The Nulls')).toBeInTheDocument();
  });

  it('is inert without an onPlay handler', () => {
    const { container } = render(<TrackRow track={track} density="compact" />);
    expect(container.firstElementChild?.className).not.toContain('cursor-pointer');
  });

  it('hides the duration unless asked for it', () => {
    const { rerender } = render(<TrackRow track={track} density="compact" />);
    expect(screen.queryByText('3:11')).toBeNull();

    rerender(<TrackRow track={track} density="compact" showDuration />);
    expect(screen.getByText('3:11')).toBeInTheDocument();
  });

  it('names the remove button from removeLabel and does not play the row', () => {
    const onPlay = vi.fn();
    const onRemove = vi.fn();
    render(
      <TrackRow
        track={track}
        density="compact"
        onPlay={onPlay}
        onRemove={onRemove}
        removeLabel={`Remove "${track.title}" from recent searches`}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove "Midnight Drive" from recent searches' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('keeps an artwork box with the fallback when the track has no art', () => {
    const { container } = render(
      <TrackRow
        track={{ ...track, artworkUrl: null }}
        density="compact"
        artworkFallback={<span data-testid="art-fallback" />}
      />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByTestId('art-fallback')).toBeInTheDocument();
  });
});
