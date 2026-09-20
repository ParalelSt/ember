import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TrackRow } from './TrackRow';
import type { Track } from '@/types/track';

const toast = vi.hoisted(() => Object.assign(vi.fn(), { message: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

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

  it('uses artworkSrc over track.artworkUrl when given', () => {
    const { container } = render(<TrackRow track={track} artworkSrc="capfile:///data/art/a1.jpg" />);
    expect(container.querySelector('img')).toHaveAttribute('src', 'capfile:///data/art/a1.jpg');
  });

  it('falls back to track.artworkUrl when artworkSrc is not given', () => {
    const { container } = render(<TrackRow track={track} />);
    expect(container.querySelector('img')).toHaveAttribute('src', track.artworkUrl!);
  });

  it('renders no artwork box when artworkSrc is explicitly null and the track has no art', () => {
    const { container } = render(<TrackRow track={{ ...track, artworkUrl: null }} artworkSrc={null} />);
    expect(container.querySelector('img')).toBeNull();
  });

  // Regression: the desktop 5-column shape (album + duration) used to key
  // off the viewport (md:), so a narrow container on a wide window (the
  // search overlay, capped at ~576px, on any laptop-or-wider display) still
  // got the desktop grid and squeezed title/album into equal, too-narrow
  // halves. It must key off the row's own container instead, via @3xl (the
  // same 768px the old md: breakpoint used, on the container-query scale),
  // so a narrow container always gets the 3-column "phone" shape regardless
  // of window size.
  it('switches columns by container width (@3xl), not viewport width', () => {
    render(<TrackRow track={track} />);
    const row = screen.getByTestId('track-row');
    expect(row.className).toContain('grid-cols-[40px_minmax(0,1fr)_auto]');
    expect(row.className).toContain('@3xl:grid-cols-[40px_minmax(0,1fr)_minmax(0,1fr)_60px_auto]');
    expect(row.className).not.toContain(' md:grid-cols');
  });

  it('hides the album and duration cells below the @3xl container threshold, shows them above it', () => {
    render(<TrackRow track={track} />);
    const albumCell = screen.getByTestId('track-row-album-cell');
    expect(albumCell.className).toContain('hidden');
    expect(albumCell.className).toContain('@3xl:block');
    expect(albumCell.className).not.toContain(' md:block');
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

describe('TrackRow (unavailable)', () => {
  const dead: Track = { ...track, unavailableAt: '2026-09-09T00:00:00.000Z', unavailableReason: 'removed' };

  it('badges the title, greys the row and disables its play cell', () => {
    const { container } = render(<TrackRow track={dead} unavailable onPlay={vi.fn()} />);
    const badge = screen.getByTestId('unavailable-badge');
    expect(badge).toHaveTextContent('Unavailable');
    expect(badge).toHaveAttribute('title', 'Removed from YouTube');
    expect(screen.getByRole('button', { name: 'Unavailable' })).toBeDisabled();
    expect(container.querySelector('[data-unavailable="true"]')).not.toBeNull();
    expect(container.firstElementChild?.className).toContain('opacity-60');
  });

  it('falls back to a generic reason when the code is unknown', () => {
    render(<TrackRow track={{ ...dead, unavailableReason: 'weird' }} unavailable />);
    expect(screen.getByTestId('unavailable-badge')).toHaveAttribute('title', 'Not available');
  });

  it('explains instead of playing when the title is clicked', () => {
    const onPlay = vi.fn();
    render(<TrackRow track={dead} unavailable onPlay={onPlay} />);
    fireEvent.click(screen.getByText('Midnight Drive'));
    expect(onPlay).not.toHaveBeenCalled();
    expect(toast.message).toHaveBeenCalledWith('"Midnight Drive" is unavailable on YouTube');
  });

  it('still plays a normal row on click', () => {
    const onPlay = vi.fn();
    render(<TrackRow track={track} onPlay={onPlay} />);
    fireEvent.click(screen.getByText('Midnight Drive'));
    expect(onPlay).toHaveBeenCalledTimes(1);
    expect(toast.message).not.toHaveBeenCalled();
  });

  it('offers Find replacement only when onReplace is given', () => {
    const onReplace = vi.fn();
    const { rerender } = render(<TrackRow track={dead} unavailable />);
    expect(screen.queryByRole('button', { name: 'Find replacement' })).toBeNull();

    rerender(<TrackRow track={dead} unavailable onReplace={onReplace} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find replacement' }));
    expect(onReplace).toHaveBeenCalledTimes(1);
  });

  it('shows no badge and an enabled play button on an available track', () => {
    render(<TrackRow track={track} onPlay={vi.fn()} />);
    expect(screen.queryByTestId('unavailable-badge')).toBeNull();
    expect(screen.getByRole('button', { name: 'Play' })).toBeEnabled();
  });
});

// The search overlay's row shape (the owner's pick from /dizajn: a trailing
// play/pause button, and the current row marked by its title in the ember
// accent with no glyph). Everything here is off unless `trailingPlayControl`
// is passed, which the "unchanged by default" block below pins down.
describe('TrackRow (trailingPlayControl)', () => {
  const reveal = (el: HTMLElement) => el.className;

  it('is off by default: no trailing control, leading play cell, whole-row tint', () => {
    const { container, rerender } = render(<TrackRow track={track} onPlay={vi.fn()} />);
    expect(screen.queryByTestId('track-row-play')).toBeNull();
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(container.firstElementChild?.className).toContain('grid-cols-[40px_minmax(0,1fr)_auto]');

    rerender(<TrackRow track={track} active playing onPlay={vi.fn()} />);
    expect(container.firstElementChild?.className).toContain('text-ember');
    expect(screen.getByTestId('track-row-title').className).not.toContain('text-ember');
  });

  it('is off by default on a compact row too', () => {
    const { container } = render(<TrackRow track={track} density="compact" active playing onPlay={vi.fn()} />);
    expect(screen.queryByTestId('track-row-play')).toBeNull();
    expect(container.firstElementChild?.className).toContain('text-ember');
    expect(screen.getByTestId('track-row-title').className).not.toContain('text-ember');
  });

  for (const density of ['list', 'compact'] as const) {
    describe(`${density} density`, () => {
      const row = (over: Partial<ComponentProps<typeof TrackRow>> = {}) => (
        <TrackRow track={track} density={density} trailingPlayControl onPlay={vi.fn()} {...over} />
      );

      it('names the song and the action, and hides the button until hover or focus', () => {
        render(row());
        const button = screen.getByRole('button', { name: 'Play Midnight Drive' });
        expect(button).toBe(screen.getByTestId('track-row-play'));
        // Hidden with opacity, not removed: its space is already reserved,
        // so revealing it on hover shifts nothing.
        expect(reveal(button)).toContain('opacity-0');
        expect(reveal(button)).toContain('group-hover:opacity-100');
        // A phone has no hover, so there the button is simply always shown.
        expect(reveal(button)).toContain('max-md:opacity-100');
      });

      it('keyboard focus reveals it: the row is the group and the button can take focus', () => {
        const { container } = render(row());
        const button = screen.getByTestId('track-row-play');
        expect(container.firstElementChild?.className).toContain('group');
        expect(reveal(button)).toContain('group-focus-within:opacity-100');
        expect(reveal(button)).toContain('focus-visible:opacity-100');

        button.focus();
        expect(document.activeElement).toBe(button);
      });

      it('is always visible on the playing row, in both states, and never hidden there', () => {
        const { rerender } = render(row({ active: true, playing: true }));
        let button = screen.getByRole('button', { name: 'Pause Midnight Drive' });
        expect(reveal(button)).not.toContain('opacity-0');
        expect(reveal(button)).toContain('text-ember');

        rerender(row({ active: true, playing: false }));
        button = screen.getByRole('button', { name: 'Resume Midnight Drive' });
        expect(reveal(button)).not.toContain('opacity-0');
      });

      it('uses the phone touch size and the desktop row size', () => {
        render(row());
        expect(reveal(screen.getByTestId('track-row-play'))).toContain('size-hit md:size-8');
      });

      it('plays this track, then pauses and resumes it once it is the current one', () => {
        const onPlay = vi.fn();
        const onToggle = vi.fn();
        const { rerender } = render(row({ onPlay, onToggle }));

        fireEvent.click(screen.getByRole('button', { name: 'Play Midnight Drive' }));
        expect(onPlay).toHaveBeenCalledTimes(1);
        expect(onToggle).not.toHaveBeenCalled();

        rerender(row({ onPlay, onToggle, active: true, playing: true }));
        fireEvent.click(screen.getByRole('button', { name: 'Pause Midnight Drive' }));
        expect(onToggle).toHaveBeenCalledTimes(1);
        expect(onPlay).toHaveBeenCalledTimes(1);

        rerender(row({ onPlay, onToggle, active: true, playing: false }));
        fireEvent.click(screen.getByRole('button', { name: 'Resume Midnight Drive' }));
        expect(onToggle).toHaveBeenCalledTimes(2);
        expect(onPlay).toHaveBeenCalledTimes(1);
      });

      it('marks the current row by its title in ember, in both states, with no glyph', () => {
        const { container, rerender } = render(row({ active: true, playing: true }));
        const title = () => screen.getByTestId('track-row-title');
        expect(title().className).toContain('text-ember');
        expect(title().querySelector('svg')).toBeNull();
        // The whole line is NOT tinted: the title carries the mark alone.
        expect(container.firstElementChild?.className).not.toContain('text-ember');

        rerender(row({ active: true, playing: false }));
        expect(title().className).toContain('text-ember');
        expect(title().querySelector('svg')).toBeNull();
      });

      it('leaves an idle row title alone', () => {
        render(row());
        expect(screen.getByTestId('track-row-title').className).not.toContain('text-ember');
      });

    });
  }

  // A compact row plays on a single click of the row itself, so the
  // control's press must not reach it: pausing the current row would
  // otherwise restart it in the same click.
  it('does not let a compact control press reach the row underneath', () => {
    const onPlay = vi.fn();
    const onToggle = vi.fn();
    render(
      <TrackRow
        track={track}
        density="compact"
        trailingPlayControl
        active
        playing
        onPlay={onPlay}
        onToggle={onToggle}
      />,
    );

    fireEvent.click(screen.getByTestId('track-row-play'));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('drops the leading play column on a list row, so nothing sits before the title', () => {
    const { container } = render(<TrackRow track={track} trailingPlayControl onPlay={vi.fn()} />);
    expect(container.firstElementChild?.className).toContain('grid-cols-[minmax(0,1fr)_auto]');
    expect(container.firstElementChild?.className).not.toContain('grid-cols-[40px_');
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
  });

  it('disables the control and says so on an unavailable track', () => {
    const onPlay = vi.fn();
    render(<TrackRow track={track} trailingPlayControl unavailable onPlay={onPlay} />);
    const button = screen.getByTestId('track-row-play');
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-label', '"Midnight Drive" is unavailable');
  });
});
