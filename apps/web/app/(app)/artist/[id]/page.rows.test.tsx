import { Suspense, type ComponentProps } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import ArtistPage from './page';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));
const nav = vi.hoisted(() => ({ query: '' }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(nav.query),
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));
vi.mock('@/lib/useOnline', () => ({ useOnline: () => true }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => false }));
vi.mock('@/components/track/menus/TrackMenu', () => ({ renderTrackMenu: () => null }));
vi.mock('@/hooks/useTrackActions', () => ({
  useTrackActions: () => ({
    currentId: null, isPlaying: false, likedIds: new Set<string>(),
    onPlay: vi.fn(), onToggle: vi.fn(), onLike: vi.fn(), artworkSrcFor: () => null,
  }),
}));

const mk = (p: string, n: number) => Array.from({ length: n }, (_, i) => ({ browseId: `${p}${i}`, title: `${p} ${i}`, year: 2000, thumbnails: [] }));
const data = { name: 'Band', description: '', thumbnails: [], tracks: [], albums: mk('Album', 6), singles: mk('Single', 5) };
vi.mock('@/hooks/useLibrary', () => ({
  useQueryArtist: () => ({ data, isLoading: false, error: null, refetch: vi.fn() }),
}));

async function show() {
  await act(async () => {
    render(<Suspense fallback={null}><ArtistPage params={Promise.resolve({ id: 'UC1' })} /></Suspense>);
  });
}

beforeEach(() => { nav.query = ''; });

describe('artist page rows', () => {
  it('each row shows two whole cards and its own Show all', async () => {
    await show();
    const disc = within(screen.getByRole('region', { name: 'Discography' }));
    expect(disc.getAllByRole('listitem')).toHaveLength(2);
    expect(disc.getByRole('link', { name: 'Show all' })).toHaveAttribute('href', '/artist/UC1?row=albums');
    const singles = within(screen.getByRole('region', { name: 'Singles & EPs' }));
    expect(singles.getAllByRole('listitem')).toHaveLength(2);
    expect(singles.getByRole('link', { name: 'Show all' })).toHaveAttribute('href', '/artist/UC1?row=singles');
  });

  it('?row=albums lists every album alone with Back to the artist', async () => {
    nav.query = 'row=albums';
    await show();
    const row = within(screen.getByRole('region', { name: 'Discography' }));
    expect(row.getAllByRole('listitem')).toHaveLength(6);
    expect(row.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/artist/UC1');
    expect(screen.queryByRole('region', { name: 'Singles & EPs' })).toBeNull();
    expect(screen.queryByText('Popular')).toBeNull();
  });

  it('?row=singles lists every single', async () => {
    nav.query = 'row=singles';
    await show();
    expect(within(screen.getByRole('region', { name: 'Singles & EPs' })).getAllByRole('listitem')).toHaveLength(5);
  });
});
