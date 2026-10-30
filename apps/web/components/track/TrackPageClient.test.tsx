import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { backRouteFor } from '@/lib/nav';
import type { Track } from '@/types/track';

const state = vi.hoisted(() => ({
  online: true,
  query: { data: undefined, isLoading: false, error: null } as { data?: unknown; isLoading: boolean; error: unknown },
  liked: false,
  toggle: vi.fn(),
  playTrack: vi.fn(),
  share: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/useOnline', () => ({ useOnline: () => state.online }));
vi.mock('@/hooks/useLibrary', () => ({ useQueryTrack: () => state.query }));
vi.mock('@/hooks/useLikeToggle', () => ({
  useLikeToggle: () => ({ liked: state.liked, toggle: state.toggle }),
}));
vi.mock('@/components/player/PlayerProvider', () => ({ usePlayer: () => ({ playTrack: state.playTrack }) }));
vi.mock('@/components/track/ShareButton', () => ({
  canShare: (t: Track) => t.source === 'youtube',
  shareTrack: state.share,
}));
vi.mock('@/components/track/menus/TrackMenu', () => ({
  TrackMenu: ({ track, triggerClassName }: { track: Track; triggerClassName?: string }) => (
    <button type="button" aria-label={`More for ${track.title}`} className={triggerClassName} />
  ),
}));

const { TrackPageClient } = await import('./TrackPageClient');

const TRACK: Track = {
  id: 'youtube:a1',
  source: 'youtube',
  sourceId: 'a1',
  title: 'Midnight Drive',
  artist: 'The Nulls',
  artistId: 'art1',
  album: 'Night Shift',
  albumId: 'alb1',
  durationSec: 191,
  artworkUrl: 'https://img.test/a.jpg',
  streamUrl: '/stream/a1',
};

beforeEach(() => {
  vi.clearAllMocks();
  state.online = true;
  state.liked = false;
  state.query = { data: TRACK, isLoading: false, error: null };
});

describe('Song page', () => {
  it('uses the playlists\' header: Song label, big title, artist link, album, duration', () => {
    render(<TrackPageClient videoId="a1" />);
    const header = screen.getByTestId('collection-header');
    expect(within(header).getByText('Song').className).toContain('text-eyebrow');
    const title = within(header).getByRole('heading', { level: 1, name: 'Midnight Drive' });
    expect(title.className).toContain('text-hero-title');
    expect(within(header).getByRole('link', { name: 'The Nulls' })).toHaveAttribute('href', '/artist/art1');
    const meta = within(header).getByTestId('collection-meta');
    expect(meta).toHaveTextContent('The Nulls · Night Shift · 3:11');
  });

  it('puts the action row under the header, not in its text column', () => {
    render(<TrackPageClient videoId="a1" />);
    const header = screen.getByTestId('collection-header');
    const bar = screen.getByTestId('action-bar');
    expect(header).not.toContainElement(bar);
    expect(header.compareDocumentPosition(bar) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(bar).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Play Midnight Drive',
      'Like',
      'Share Midnight Drive',
      'More for Midnight Drive',
    ]);
  });

  it('Play plays the song, the heart toggles, share shares', () => {
    render(<TrackPageClient videoId="a1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Play Midnight Drive' }));
    expect(state.playTrack).toHaveBeenCalledWith(TRACK);
    fireEvent.click(screen.getByRole('button', { name: 'Like' }));
    expect(state.toggle).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Share Midnight Drive' }));
    expect(state.share).toHaveBeenCalledWith(TRACK);
  });

  it('every button but Play is a round action circle, and the menu keeps the same shape', () => {
    render(<TrackPageClient videoId="a1" />);
    for (const name of ['Like', 'Share Midnight Drive', 'More for Midnight Drive']) {
      const b = screen.getByRole('button', { name });
      expect(b.className).toContain('size-12');
      expect(b.className).toContain('rounded-full');
    }
  });

  it('a liked song shows the heart on', () => {
    state.liked = true;
    render(<TrackPageClient videoId="a1" />);
    const heart = screen.getByRole('button', { name: 'Unlike' });
    expect(heart).toHaveAttribute('aria-pressed', 'true');
    expect(heart.className).toContain('text-ember');
  });

  it('a song with no share id has no share button', () => {
    state.query = { data: { ...TRACK, source: 'jamendo' }, isLoading: false, error: null };
    render(<TrackPageClient videoId="a1" />);
    expect(screen.queryByRole('button', { name: /^Share/ })).toBeNull();
  });

  it('an artist with no id is plain text, not a dead link', () => {
    state.query = { data: { ...TRACK, artistId: undefined }, isLoading: false, error: null };
    render(<TrackPageClient videoId="a1" />);
    expect(screen.queryByRole('link', { name: 'The Nulls' })).toBeNull();
    expect(screen.getByText('The Nulls')).toBeInTheDocument();
  });

  it('keeps the not-found state with its Home link', () => {
    state.query = { data: undefined, isLoading: false, error: new Error('404') };
    render(<TrackPageClient videoId="nope" />);
    expect(screen.getByText(/Track not found/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.queryByTestId('action-bar')).toBeNull();
  });

  it('keeps Loading and the offline placeholder', () => {
    state.query = { data: undefined, isLoading: true, error: null };
    const { unmount } = render(<TrackPageClient videoId="a1" />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    unmount();
    state.online = false;
    render(<TrackPageClient videoId="a1" />);
    expect(screen.getByText("You're offline")).toBeInTheDocument();
  });

  it('keeps its back button route', () => {
    expect(backRouteFor('/track/a1')).toEqual({ fallbackHref: '/', phone: true });
  });
});
