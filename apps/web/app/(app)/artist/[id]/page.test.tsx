import { Suspense, type ComponentProps } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import ArtistPage from './page';
import AlbumPage from '../../album/[id]/page';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/useOnline', () => ({ useOnline: () => true }));
vi.mock('@/components/track/menus/TrackMenu', () => ({ renderTrackMenu: () => null }));
vi.mock('@/hooks/useTrackActions', () => ({
  useTrackActions: () => ({
    currentId: null, isPlaying: false, likedIds: new Set<string>(),
    onPlay: vi.fn(), onToggle: vi.fn(), onLike: vi.fn(), artworkSrcFor: () => null,
  }),
}));

const query = vi.hoisted(() => ({
  error: null as (Error & { status?: number }) | null,
  refetch: vi.fn(),
}));
vi.mock('@/hooks/useLibrary', () => ({
  useQueryArtist: () => ({ data: undefined, isLoading: false, error: query.error, refetch: query.refetch }),
  useQueryAlbum: () => ({ data: undefined, isLoading: false, error: query.error, refetch: query.refetch }),
}));

function failWith(status: number, message: string) {
  query.error = Object.assign(new Error(message), { status });
}

async function show(page: 'artist' | 'album') {
  const params = Promise.resolve({ id: 'UCabcdefgh123' });
  await act(async () => {
    render(
      <Suspense fallback={null}>
        {page === 'artist' ? <ArtistPage params={params} /> : <AlbumPage params={params} />}
      </Suspense>,
    );
  });
}

beforeEach(() => {
  query.error = null;
  query.refetch.mockReset();
});

describe.each(['artist', 'album'] as const)('%s page when YouTube Music cannot be reached', (page) => {
  it('says it could not load, not that it does not exist, and offers to try again', async () => {
    failWith(502, `Couldn't load this ${page} from YouTube Music right now`);
    await show(page);
    expect(screen.queryByText(/not found/i)).toBeNull();
    expect(screen.getByText(`Couldn't load this ${page} from YouTube Music right now`)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(query.refetch).toHaveBeenCalledTimes(1);
  });

  it('still says not found for a real 404', async () => {
    failWith(404, 'Not found');
    await show(page);
    expect(screen.getByText(new RegExp(`${page} not found`, 'i'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });
});
