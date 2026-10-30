import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from '@/components/page/EmptyState';

// What Liked songs and Recently played hand to the empty collection. The page
// shell and CollectionPage's own wiring have their own tests.
const online = vi.hoisted(() => ({ value: true }));

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/useOnline', () => ({ useOnline: () => online.value }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/components/library/CollectionPage', () => ({
  CollectionPage: ({ emptyMessage, empty }: { emptyMessage: string; empty?: object }) => (
    <EmptyState {...empty}>{emptyMessage}</EmptyState>
  ),
}));
vi.mock('@/components/track/menus/ReplaceTrackDialog', () => ({ ReplaceTrackDialog: () => null }));
vi.mock('@/components/track/menus/TrackMenu', () => ({ renderTrackMenu: () => null, TrackMenu: () => null }));
vi.mock('@/components/track/menus/CopySongsBar', () => ({ CopySongsBar: () => null }));
vi.mock('@/components/import/ReviewSheet', () => ({ ReviewSheet: () => null }));
vi.mock('@/hooks/useImports', () => ({
  useImportActions: () => ({}),
  useLikedImportJob: () => ({ job: null, items: [] }),
}));
vi.mock('@/hooks/useImportReview', () => ({ useImportReview: () => ({}) }));
vi.mock('@/hooks/useTrackActions', () => ({ useTrackActions: () => ({}) }));
vi.mock('@/hooks/useCollectionPlayback', () => ({ useCollectionPlayback: () => ({}) }));
vi.mock('@/hooks/useCollectionSort', () => ({ useCollectionSort: () => ['added', vi.fn()] }));
vi.mock('@/hooks/useTrackSelection', () => ({ useTrackSelection: () => ({}) }));
vi.mock('@/hooks/useOfflinePin', () => ({ useOfflinePin: () => null }));
vi.mock('@/lib/playlistCopy', () => ({ DEFAULT_LIKED_SORT: 'added', sortCollection: (t: unknown) => t }));
vi.mock('@/hooks/useLibrary', () => ({
  QK: { likes: ['likes'] },
  useQueryLikes: () => ({ data: [], isLoading: false, isError: false }),
  useQueryHistory: () => ({ data: [], isLoading: false, isError: false }),
  useExecuteReplaceLike: () => ({}),
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));

const { default: LikedPage } = await import('./liked/page');
const { default: RecentPage } = await import('./recent/page');

beforeEach(() => {
  online.value = true;
});

describe.each([
  ['Liked songs', LikedPage, 'Nothing liked yet', /Tap the heart/],
  ['Recently played', RecentPage, 'Nothing played yet', /Songs you play/],
])('%s, empty', (_name, Page, title, sentence) => {
  it('has an icon, a title, the sentence and Find songs, to Search', () => {
    render(<Page />);
    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText(sentence)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Find songs' })).toHaveAttribute('href', '/search');
  });

  it('offline stays a plain line: Search does not work there', () => {
    online.value = false;
    render(<Page />);
    expect(screen.getByText(/^Offline\. Open this once/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByTestId('empty-icon')).toBeNull();
  });
});
