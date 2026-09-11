import type { ComponentProps } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FriendsListening } from './FriendsListening';
import type { Track } from '@/types/track';

// next/link reads the app router context and resolves the repo root's
// React 18 through next's dist, so component tests render a plain anchor
// instead (see components/OnlineOnly.test.tsx). TrackCard's artist link
// needs this mock even though this test never asserts on it.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const playTrack = vi.fn();
vi.mock('@/components/player/PlayerProvider', () => ({
  usePlayer: () => ({ playTrack }),
}));

const auth = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => auth }));

const api = vi.hoisted(() => ({ listening: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

function makeTrack(over: Partial<Track> = {}): Track {
  return {
    id: 'youtube:a1',
    source: 'youtube',
    sourceId: 'a1',
    title: 'Midnight Drive',
    artist: 'The Nulls',
    artistId: null,
    album: null,
    albumId: null,
    durationSec: 191,
    artworkUrl: null,
    streamUrl: '',
    ...over,
  };
}

// A fixed instant so formatAgo's "X minutes ago" output is deterministic;
// formatAgo takes `now` as an optional second argument, and this component
// calls it with only the iso string, so the test pins Date.now() instead.
const NOW = new Date('2026-01-01T12:00:00Z').getTime();

function renderWithClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FriendsListening />
    </QueryClientProvider>,
  );
}

// Mock Date.now only (not fake timers): the component's own formatAgo call
// needs a fixed "now", but react-query and @testing-library's waitFor both
// depend on real timers to resolve promises and poll, so faking those too
// would hang every await below.
let dateNowSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  auth.user = { id: 'u1' };
  dateNowSpy = vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  dateNowSpy.mockRestore();
});

describe('FriendsListening', () => {
  it('renders nothing when nobody is listening', async () => {
    api.listening.mockResolvedValue({ items: [] });
    const { container } = renderWithClient();
    await waitFor(() => expect(api.listening).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('renders one card per item with title and the who-and-when subtitle', async () => {
    api.listening.mockResolvedValue({
      items: [
        {
          userName: 'Robin',
          playedAt: new Date(NOW - 5 * 60_000).toISOString(),
          track: makeTrack(),
        },
      ],
    });
    renderWithClient();

    expect(await screen.findByText('Midnight Drive')).toBeInTheDocument();
    expect(screen.getByText('The Nulls')).toBeInTheDocument();
    expect(screen.getByText('Robin · 5 min ago')).toBeInTheDocument();
  });

  it('renders a separate card per listener, even for the same track', async () => {
    api.listening.mockResolvedValue({
      items: [
        { userName: 'Robin', playedAt: new Date(NOW - 60_000).toISOString(), track: makeTrack() },
        {
          userName: 'Sam',
          playedAt: new Date(NOW - 120_000).toISOString(),
          track: makeTrack({ id: 'youtube:b2', sourceId: 'b2', title: 'Second Wind' }),
        },
      ],
    });
    renderWithClient();

    expect(await screen.findByText('Midnight Drive')).toBeInTheDocument();
    expect(screen.getByText('Second Wind')).toBeInTheDocument();
    // One hover play button per card (the card itself is a div, not a
    // button; TrackCard.test.tsx covers its own click/activate wiring).
    expect(screen.getAllByRole('button', { name: 'Play' })).toHaveLength(2);
  });

  it('activating a card calls playTrack with that item', async () => {
    const track = makeTrack();
    api.listening.mockResolvedValue({
      items: [{ userName: 'Robin', playedAt: new Date(NOW - 60_000).toISOString(), track }],
    });
    renderWithClient();

    fireEvent.click(await screen.findByText('Midnight Drive'));
    expect(playTrack).toHaveBeenCalledWith(track);
  });
});
