import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { IMPORT_POLL_MS, useLikedImportJob } from '@/hooks/useImports';
import type { ImportItem, ImportJob } from '@/lib/import/types';
import type { ItemStatus } from '@/lib/import/jobState';

vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));

const api = vi.hoisted(() => ({ listImportJobs: vi.fn(), getImportJob: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

// The Liked page while a long transfer runs. The jobs list (one small row
// per import) is the progress; the transfer's items (thousands of rows) are
// fetched again only when something the page draws from them changed.

const job = (over: Partial<ImportJob> = {}): ImportJob => ({
  id: 't1',
  userId: 'u1',
  kind: 'liked',
  playlistId: null,
  name: 'Liked songs from Spotify',
  source: 'csv',
  sourceUrl: '',
  coverUrl: null,
  status: 'running',
  total: 20,
  cursor: 0,
  accepted: 0,
  review: 0,
  missing: 0,
  existing: 0,
  error: null,
  retryAt: null,
  dismissed: false,
  ...over,
});

const item = (position: number, status: ItemStatus): ImportItem => ({
  id: `i${position}`,
  position,
  status,
  source: { position, title: `Song ${position}`, artists: ['A'], artist: 'A', durationMs: null, explicit: null, uri: null },
  likedAt: null,
  videoId: status === 'accepted' ? `vid${position}` : null,
  confidence: null,
  candidates: [],
});

let summary: ImportJob;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  summary = job();
  api.listImportJobs.mockImplementation(async () => ({ jobs: [summary] }));
  api.getImportJob.mockImplementation(async () => ({
    job: summary,
    items: Array.from({ length: 20 }, (_, i) => item(i, 'pending')),
  }));
});

afterEach(() => {
  vi.useRealTimers();
});

const polls = async (n: number) => {
  for (let i = 0; i < n; i++) await act(() => vi.advanceTimersByTimeAsync(IMPORT_POLL_MS));
};

describe('useLikedImportJob while a transfer runs', () => {
  it('polls the small jobs list, not every item, as songs are matched', async () => {
    const { result } = renderHook(() => useLikedImportJob(), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(20));
    expect(api.getImportJob).toHaveBeenCalledTimes(1);

    // Three batches go by, each one a like more and the cursor moved on.
    for (let b = 1; b <= 3; b++) {
      summary = job({ cursor: b * 4, accepted: b * 4 });
      await polls(1);
    }
    await waitFor(() => expect(result.current.job?.cursor).toBe(12));
    expect(api.listImportJobs.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(api.getImportJob).toHaveBeenCalledTimes(1);
    // Songs below the cursor have been matched: none still shows as waiting.
    expect(result.current.items.filter((i) => i.status === 'pending').map((i) => i.position)).toEqual([
      12, 13, 14, 15, 16, 17, 18, 19,
    ]);
  });

  it('fetches the items again when a song needs a look, and when the transfer ends', async () => {
    const { result } = renderHook(() => useLikedImportJob(), { wrapper });
    await waitFor(() => expect(api.getImportJob).toHaveBeenCalledTimes(1));

    summary = job({ cursor: 8, accepted: 7, review: 1 });
    await polls(1);
    await waitFor(() => expect(api.getImportJob).toHaveBeenCalledTimes(2));

    summary = job({ status: 'done', cursor: 20, accepted: 19, review: 1 });
    await polls(1);
    await waitFor(() => expect(api.getImportJob).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.job?.status).toBe('done'));
  });
});
