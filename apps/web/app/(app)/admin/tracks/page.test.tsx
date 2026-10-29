import type { PropsWithChildren, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { AdminTrack } from '@/lib/api';

// See users/page.test.tsx: render the base-ui Dialog and Sheet as plain
// elements so this test is about the page's own wiring.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, onOpenChange, children }: PropsWithChildren<{ open?: boolean; onOpenChange?: (o: boolean) => void }>) => (open ? (
    <div>
      {children}
      <button type="button" onClick={() => onOpenChange?.(false)}>Close dialog</button>
    </div>
  ) : null),
  DialogContent: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div>,
  DialogFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
  DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
}));
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children, 'data-testid': testId }: { children: ReactNode; 'data-testid'?: string }) => (
    <div role="dialog" data-testid={testId}>{children}</div>
  ),
  SheetTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const track = (i: number, extra: Partial<AdminTrack> = {}): AdminTrack => ({
  id: `upload:${i}`, recordId: `r${i}`, source: 'upload', sourceId: String(i),
  title: `Song ${i}`, artist: `Artist ${i}`, artistId: null, album: `Album ${i}`, albumId: null,
  durationSec: 180, artworkUrl: `/art/${i}.jpg`, streamUrl: '', ...extra,
});

type Answer = { tracks: AdminTrack[]; page: number; totalPages: number; totalItems: number };
const state = vi.hoisted(() => ({
  desktop: true,
  query: vi.fn(),
  update: vi.fn(async () => ({ ok: true })),
  remove: vi.fn(async () => ({ ok: true })),
  /** Overrides the answer for a page (the default is one page of three). */
  pages: null as null | ((page: number) => Answer),
  error: null as Error | null,
}));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => state.desktop }));
vi.mock('@/hooks/useAdmin', () => ({
  useQueryAdminTracks: (page: number, q: string) => {
    state.query(page, q);
    if (state.error) return { data: undefined, isLoading: false, isFetching: false, error: state.error };
    return {
      data: state.pages?.(page) ?? { tracks: [track(1), track(2, { missing: true }), track(3, { artworkUrl: null })], page: 1, totalPages: 1, totalItems: 3 },
      isLoading: false,
      isFetching: false,
    };
  },
  useExecuteUpdateAdminTrack: () => ({ mutateAsync: state.update }),
  useExecuteDeleteAdminTrack: () => ({ mutateAsync: state.remove }),
}));

const { default: AdminTracksPage } = await import('./page');

beforeEach(() => {
  state.desktop = true;
  state.query.mockClear();
  state.update.mockClear();
  state.remove.mockClear();
  state.pages = null;
  state.error = null;
});

describe('AdminTracksPage on desktop', () => {
  it('keeps the rows with an Edit button that opens the edit dialog', () => {
    render(<AdminTracksPage />);
    expect(screen.getByRole('heading', { name: 'Tracks · 3' })).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Tracks' })).toBeNull();
    const edits = screen.getAllByRole('button', { name: 'Edit' });
    expect(edits).toHaveLength(3);
    fireEvent.click(edits[0]);
    expect(screen.getByRole('heading', { name: 'Edit track' })).toBeInTheDocument();
    expect(screen.getByLabelText('Title')).toHaveValue('Song 1');
  });
});

describe('AdminTracksPage on a phone', () => {
  beforeEach(() => { state.desktop = false; });

  it('shows the covers three across with title and artist under each', () => {
    render(<AdminTracksPage />);
    const grid = screen.getByRole('list', { name: 'Tracks' });
    expect(grid).toHaveClass('grid', 'grid-cols-3');
    const tiles = within(grid).getAllByTestId('track-tile');
    expect(tiles).toHaveLength(3);
    expect(tiles[0]).toHaveTextContent('Song 1');
    expect(tiles[0]).toHaveTextContent('Artist 1');
    expect(tiles[0].querySelector('img')).toHaveAttribute('src', '/art/1.jpg');
    expect(tiles[1]).toHaveTextContent('Missing');
    expect(tiles[2].querySelector('img')).toBeNull();
    expect(screen.getByText('3 tracks')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('keeps the search: it runs on submit from page 1', () => {
    render(<AdminTracksPage />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tracks' }), { target: { value: ' mitski ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(state.query).toHaveBeenLastCalledWith(1, 'mitski');
  });

  it('tapping a cover opens Edit track as a sheet, and Save sends only what changed', async () => {
    render(<AdminTracksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Song 1 by Artist 1' }));
    const sheet = screen.getByTestId('track-edit-sheet');
    expect(within(sheet).getByRole('heading', { name: 'Edit track' })).toBeInTheDocument();
    expect(within(sheet).getByLabelText('Title')).toHaveValue('Song 1');
    expect(within(sheet).getByLabelText('Artist')).toHaveValue('Artist 1');
    expect(within(sheet).getByLabelText('Album')).toHaveValue('Album 1');
    fireEvent.change(within(sheet).getByLabelText('Title'), { target: { value: 'Song One' } });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Save' }));
    });
    expect(state.update).toHaveBeenCalledWith({
      recordId: 'r1',
      patch: { title: 'Song One', artist: undefined, album: undefined },
    });
    expect(screen.queryByTestId('track-edit-sheet')).toBeNull();
  });

  it('Delete in the sheet asks first, then deletes the track', async () => {
    render(<AdminTracksPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Song 2 by Artist 2' }));
    fireEvent.click(within(screen.getByTestId('track-edit-sheet')).getByRole('button', { name: 'Delete' }));
    expect(screen.queryByTestId('track-edit-sheet')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Delete "Song 2"?' })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete track' }));
    });
    expect(state.remove).toHaveBeenCalledWith('r2');
  });
});

it('goes back a page when the last page empties (its last track deleted), instead of a dead end', () => {
  // Page 2 held one track; it was deleted, so there is only one page now.
  state.pages = (page) => page === 1
    ? { tracks: [track(1)], page: 1, totalPages: 2, totalItems: 51 }
    : { tracks: [], page, totalPages: 1, totalItems: 50 };
  render(<AdminTracksPage />);
  fireEvent.click(screen.getByRole('button', { name: /Next/ }));
  expect(state.query).toHaveBeenCalledWith(2, '');
  expect(state.query).toHaveBeenLastCalledWith(1, '');
  expect(screen.queryByText('No tracks match.')).toBeNull();
});

it('says so when a page fails to load, instead of a blank page', () => {
  state.error = new Error('PocketBase is down');
  render(<AdminTracksPage />);
  expect(screen.getByText(/Couldn.t load tracks: PocketBase is down/)).toBeTruthy();
});

// The dialog kept what was typed, so a closed-without-saving edit came back
// and Save sent it.
it('reopening Edit track after closing it without saving shows the track, not the abandoned edit', async () => {
  render(<AdminTracksPage />);
  fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
  fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Abandoned' } });
  fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
  expect(screen.getByLabelText('Title')).toHaveValue('Song 1');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  });
  expect(state.update).not.toHaveBeenCalledWith(expect.objectContaining({ patch: expect.objectContaining({ title: 'Abandoned' }) }));
});
