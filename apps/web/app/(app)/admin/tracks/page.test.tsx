import type { PropsWithChildren } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { AdminTrack } from '@/lib/api';

// Render the base-ui Dialog as plain elements so this test is about the
// page's own wiring.
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: PropsWithChildren<{ open?: boolean }>) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: PropsWithChildren) => <div role="dialog">{children}</div>,
  DialogFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
  DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const track = (i: number, extra: Partial<AdminTrack> = {}): AdminTrack => ({
  id: `upload:${i}`, recordId: `r${i}`, source: 'upload', sourceId: String(i),
  title: `Song ${i}`, artist: `Artist ${i}`, artistId: null, album: `Album ${i}`, albumId: null,
  durationSec: 180, artworkUrl: `/art/${i}.jpg`, streamUrl: '', ...extra,
});

type Answer = { tracks: AdminTrack[]; page: number; totalPages: number; totalItems: number };
const state = vi.hoisted(() => ({
  query: vi.fn(),
  /** Overrides the answer for a page (the default is one page of three). */
  pages: null as null | ((page: number) => Answer),
}));
vi.mock('@/hooks/useAdmin', () => ({
  useQueryAdminTracks: (page: number, q: string) => {
    state.query(page, q);
    return {
      data: state.pages?.(page) ?? { tracks: [track(1), track(2), track(3)], page: 1, totalPages: 1, totalItems: 3 },
      isLoading: false,
      isFetching: false,
    };
  },
  useExecuteUpdateAdminTrack: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useExecuteDeleteAdminTrack: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const { default: AdminTracksPage } = await import('./page');

beforeEach(() => {
  state.query.mockClear();
  state.pages = null;
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
