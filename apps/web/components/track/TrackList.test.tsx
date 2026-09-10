import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TrackList, type TrackActions } from './TrackList';
import { songKey } from '@/lib/songKey';
import type { Track } from '@/types/track';

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
    artworkUrl: null,
    streamUrl: '',
    ...over,
  };
}

const tracks = [
  makeTrack(),
  makeTrack({ id: 'youtube:a2', sourceId: 'a2', title: 'Second Wind' }),
  makeTrack({ id: 'youtube:a3', sourceId: 'a3', title: 'Third Rail' }),
];

function actions(over: Partial<TrackActions> = {}): TrackActions {
  return {
    currentId: null,
    isPlaying: false,
    likedIds: new Set<string>(),
    onPlay: vi.fn(),
    onToggle: vi.fn(),
    ...over,
  };
}

describe('TrackList', () => {
  it('renders the empty state instead of rows', () => {
    render(<TrackList tracks={[]} {...actions()} />);
    expect(screen.getByText('No tracks')).toBeInTheDocument();
  });

  it('renders one row per track', () => {
    render(<TrackList tracks={tracks} {...actions()} />);
    expect(screen.getAllByRole('button', { name: 'Play' })).toHaveLength(3);
    expect(screen.getByText('Third Rail')).toBeInTheDocument();
  });

  it('marks only the current track as active', () => {
    render(<TrackList tracks={tracks} {...actions({ currentId: 'youtube:a2', isPlaying: true })} />);
    expect(screen.getAllByRole('button', { name: 'Play' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Pause' })).toHaveLength(1);
  });

  it('passes the track, the whole list and the context to onPlay', () => {
    const onPlay = vi.fn();
    const context = { type: 'liked' } as const;
    render(<TrackList tracks={tracks} context={context} {...actions({ onPlay })} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Play' })[1]);
    expect(onPlay).toHaveBeenCalledWith(tracks[1], tracks, context);
  });

  it('calls onToggle rather than onPlay for the current row', () => {
    const onPlay = vi.fn();
    const onToggle = vi.fn();
    render(<TrackList tracks={tracks} {...actions({ currentId: 'youtube:a1', onPlay, onToggle })} />);
    // Paused, so the active row's cell still reads "Play"; it is the first.
    fireEvent.click(screen.getAllByRole('button', { name: 'Play' })[0]);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onPlay).not.toHaveBeenCalled();
  });

  it('hides every heart when no onLike is given', () => {
    render(<TrackList tracks={tracks} {...actions()} />);
    expect(screen.queryByRole('button', { name: /like/i })).toBeNull();
  });

  it('fills the heart for liked ids and for liked variants', () => {
    const onLike = vi.fn();
    // The set holds ids plus song keys; a2's key stands in for a liked
    // variant of that song under a different id.
    const likedIds = new Set(['youtube:a1', songKey(tracks[1])]);
    render(<TrackList tracks={tracks} {...actions({ likedIds, onLike })} />);
    expect(screen.getAllByRole('button', { name: 'Unlike' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Like' })).toHaveLength(1);

    fireEvent.click(screen.getAllByRole('button', { name: 'Like' })[0]);
    expect(onLike).toHaveBeenCalledWith(tracks[2]);
  });

  it('passes the row id to onRemove and renders the trailing slot', () => {
    const onRemove = vi.fn();
    render(
      <TrackList
        tracks={tracks}
        onRemove={onRemove}
        trailing={(t) => <button type="button">Menu for {t.title}</button>}
        {...actions()}
      />,
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[2]);
    expect(onRemove).toHaveBeenCalledWith('youtube:a3');
    expect(screen.getByRole('button', { name: 'Menu for Second Wind' })).toBeInTheDocument();
  });

  it('shows ranks only when asked', () => {
    const { rerender } = render(<TrackList tracks={tracks} {...actions()} />);
    expect(screen.queryByText('1')).toBeNull();

    rerender(<TrackList tracks={tracks} showRank {...actions()} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
