import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ImportCandidate, ImportItem, ImportJob } from '@/lib/import/types';
import type { Track } from '@/types/track';

// The one list of songs a transfer was not sure about, as big artwork cards:
// Use this, Others, Skip, Undo, and Use all best guesses in the bottom bar,
// with the hooks faked.

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...rest }: ComponentProps<'button'>) => <button {...rest}>{children}</button>,
}));
vi.mock('@/components/ui/input', () => ({ Input: (props: ComponentProps<'input'>) => <input {...props} /> }));
vi.mock('@/components/primitives/Artwork', () => ({ Artwork: () => <span /> }));

const state = vi.hoisted(() => ({ job: null as ImportJob | null, items: [] as ImportItem[] }));
const actions = vi.hoisted(() => ({
  pick: { mutate: vi.fn(), mutateAsync: vi.fn() },
  skip: { mutate: vi.fn() },
  undo: { mutate: vi.fn() },
  update: { mutate: vi.fn() },
  busy: false,
}));
vi.mock('@/hooks/useImports', () => ({
  useImportJobs: () => ({ data: state.job ? [state.job] : [] }),
  useImportJob: () => ({ data: state.job ? { job: state.job, items: state.items } : undefined, isLoading: false }),
  useImportActions: () => actions,
}));
const reviewHook = vi.hoisted(() => ({
  previewId: null,
  previewPlaying: false,
  onPreview: vi.fn(),
  onSearch: vi.fn(),
  searchResults: null,
  searching: false,
  close: vi.fn(),
}));
vi.mock('@/hooks/useImportReview', () => ({ useImportReview: () => reviewHook }));

const { TransferReview } = await import('./TransferReview');

const track = (id: string, title: string): Track =>
  ({ id: `yt_${id}`, source: 'youtube', sourceId: id, title, artist: 'Halcyon Drift', durationSec: 200, artworkUrl: null }) as Track;
const cand = (id: string, title: string, score: number): ImportCandidate => ({
  track: track(id, title),
  artists: ['Halcyon Drift'],
  videoType: 'ATV',
  explicit: false,
  score,
  reasons: [],
});
const item = (id: string, position: number, status: ImportItem['status'], title: string, candidates: ImportCandidate[]): ImportItem => ({
  id,
  position,
  status,
  source: { position, title, artists: ['Halcyon Drift'], artist: 'Halcyon Drift', durationMs: 200_000, explicit: null, uri: null },
  likedAt: null,
  videoId: null,
  confidence: candidates[0]?.score ?? null,
  candidates,
});

const baseJob: ImportJob = {
  id: 'j1',
  userId: 'u1',
  kind: 'liked',
  playlistId: null,
  name: 'Liked songs from Spotify',
  source: 'spotify-export',
  sourceUrl: '',
  coverUrl: null,
  status: 'done',
  total: 40,
  cursor: 40,
  accepted: 36,
  review: 2,
  missing: 1,
  existing: 1,
  error: null,
  retryAt: null,
  dismissed: false,
};

/** Make a mutate answer as the server would. */
const succeed = (m: { mutate: ReturnType<typeof vi.fn> }) =>
  m.mutate.mockImplementation((_arg: unknown, o?: { onSuccess?: () => void }) => o?.onSuccess?.());

beforeEach(() => {
  state.job = { ...baseJob };
  state.items = [
    item('m1', 0, 'missing', 'Kindling (demo)', []),
    item('r2', 5, 'review', 'Slow Signal', [cand('a', 'Slow Signal (2019 Remaster)', 68), cand('b', 'Slow Signal', 61)]),
    item('r1', 2, 'review', 'Paper Lanterns', [cand('c', 'Paper Lanterns', 72), cand('d', 'Paper Lanterns (Live)', 70)]),
    item('ok', 1, 'accepted', 'Northbound', [cand('e', 'Northbound', 95)]),
  ];
  push.mockReset();
  toast.success.mockReset();
  for (const m of [actions.pick, actions.skip, actions.undo, actions.update]) m.mutate.mockReset();
  actions.pick.mutateAsync.mockReset();
  reviewHook.close.mockReset();
  reviewHook.onPreview.mockReset();
});

const rows = () => screen.getAllByTestId(/transfer-review-(item|done)/);

describe('TransferReview', () => {
  it('lists every unsure song, then the not-found ones, with Ember’s best guess', () => {
    render(<TransferReview jobId="j1" />);
    expect(screen.getByRole('heading', { name: '3 songs to check' })).toBeInTheDocument();
    expect(screen.getByTestId('transfer-review-result')).toHaveTextContent('We found 36 songs. 2 need a quick check, 1 we could not find, 1 you already had.');
    expect(rows().map((r) => r.textContent?.match(/On Spotify: ([^,]+)/)?.[1])).toEqual(['Paper Lanterns', 'Slow Signal', 'Kindling (demo)']);
    expect(within(rows()[0]).getByTestId('transfer-review-guess')).toHaveTextContent('Paper Lanterns');
    expect(rows()[0]).toHaveTextContent('72% match');
    expect(rows()[2]).toHaveTextContent('Nothing close enough');
    expect(within(rows()[2]).getByTestId('transfer-review-missing')).toBeInTheDocument();
    // Use all lives in the bar at the bottom, beside Back.
    const bar = screen.getByTestId('transfer-bar');
    expect(within(bar).getByRole('button', { name: 'Use all best guesses (2)' })).toBeInTheDocument();
    expect(within(bar).getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/library/liked');
  });

  it('each guess is a card with its artwork large: a tap plays it, and the match says how close', () => {
    render(<TransferReview jobId="j1" />);
    const art = within(rows()[0]).getByTestId('transfer-review-art');
    expect(art).toHaveAccessibleName('Preview "Paper Lanterns"');
    fireEvent.click(art);
    expect(reviewHook.onPreview).toHaveBeenCalledWith(expect.objectContaining({ sourceId: 'c' }));
    expect(rows()[0]).toHaveTextContent('Halcyon Drift · 3:20');
    // 72% is a strong match, 68% too; under 65 would be muted.
    expect(within(rows()[0]).getByTestId('transfer-review-match')).toHaveAttribute('data-strong', 'true');
  });

  it('a weak best guess has a muted match', () => {
    state.items = [item('r9', 0, 'review', 'Glasshouse', [cand('z', 'Glasshouse (Cover)', 52)])];
    render(<TransferReview jobId="j1" />);
    expect(screen.getByTestId('transfer-review-match')).toHaveAttribute('data-strong', 'false');
    expect(screen.getByTestId('transfer-review-match')).toHaveTextContent('52% match');
  });

  it('a new playlist goes back to that playlist', () => {
    state.job = { ...baseJob, kind: 'playlist', playlistId: 'p1' };
    render(<TransferReview jobId="j1" />);
    expect(within(screen.getByTestId('transfer-bar')).getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/playlist/p1');
  });

  it('Use likes the best guess, and the row says so with Undo', () => {
    succeed(actions.pick);
    render(<TransferReview jobId="j1" />);
    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Use this' }));
    expect(actions.pick.mutate.mock.calls[0][0]).toEqual({ itemId: 'r1', track: expect.objectContaining({ sourceId: 'c' }) });
    expect(toast.success).toHaveBeenCalledWith('Liked "Paper Lanterns"', { position: 'top-center' });
    expect(screen.getAllByTestId('transfer-review-done')[0]).toHaveTextContent('Liked Paper Lanterns');
    expect(screen.getByRole('button', { name: 'Use all best guesses (1)' })).toBeInTheDocument();
  });

  it('Undo puts a used song back the way it was', () => {
    succeed(actions.pick);
    succeed(actions.undo);
    render(<TransferReview jobId="j1" />);
    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Use this' }));
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(actions.undo.mutate.mock.calls[0][0]).toEqual({ itemId: 'r1', to: 'review' });
    expect(screen.queryAllByTestId('transfer-review-done')).toHaveLength(0);
  });

  it('Skip leaves it out, and Undo of a not-found song puts it back as not found', () => {
    succeed(actions.skip);
    succeed(actions.undo);
    render(<TransferReview jobId="j1" />);
    fireEvent.click(within(rows()[2]).getByRole('button', { name: 'Skip' }));
    expect(actions.skip.mutate.mock.calls[0][0]).toBe('m1');
    expect(screen.getByTestId('transfer-review-done')).toHaveTextContent('Skipped Kindling (demo)');
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(actions.undo.mutate.mock.calls[0][0]).toEqual({ itemId: 'm1', to: 'missing' });
  });

  it('Other versions opens the other candidates and a search; picking one uses it', () => {
    succeed(actions.pick);
    render(<TransferReview jobId="j1" />);
    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Others' }));
    const others = screen.getByTestId('transfer-review-others');
    expect(within(others).getByLabelText('Search YouTube Music')).toHaveValue('Paper Lanterns Halcyon Drift');
    fireEvent.click(within(others).getByText('Paper Lanterns (Live)'));
    expect(actions.pick.mutate.mock.calls[0][0].track.sourceId).toBe('d');
    expect(screen.queryByTestId('transfer-review-others')).toBeNull();
  });

  it('a not-found song offers a search instead of a guess', () => {
    render(<TransferReview jobId="j1" />);
    expect(within(rows()[2]).queryByRole('button', { name: 'Use this' })).toBeNull();
    fireEvent.click(within(rows()[2]).getByRole('button', { name: 'Search' }));
    fireEvent.submit(within(screen.getByTestId('transfer-review-others')).getByLabelText('Search YouTube Music').closest('form')!);
    expect(reviewHook.onSearch).toHaveBeenCalledWith('Kindling (demo) Halcyon Drift');
  });

  it('Use all best guesses uses every unsure song’s guess, one after another', async () => {
    actions.pick.mutateAsync.mockResolvedValue({});
    render(<TransferReview jobId="j1" />);
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Use all best guesses (2)' })));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Liked 2 songs', { position: 'top-center' }));
    expect(actions.pick.mutateAsync.mock.calls.map((c) => c[0].itemId)).toEqual(['r1', 'r2']);
    expect(screen.getAllByTestId('transfer-review-done')).toHaveLength(2);
  });

  it('a new playlist says Added, not Liked', () => {
    succeed(actions.pick);
    state.job = { ...baseJob, kind: 'playlist', playlistId: 'p1' };
    render(<TransferReview jobId="j1" />);
    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Use this' }));
    expect(toast.success).toHaveBeenCalledWith('Added "Paper Lanterns"', { position: 'top-center' });
  });

  it('once every song is settled: All sorted, and Done closes the transfer', () => {
    succeed(actions.skip);
    state.items = [item('m1', 0, 'missing', 'Kindling (demo)', [])];
    render(<TransferReview jobId="j1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(screen.getByTestId('transfer-review-all-done')).toHaveTextContent('All sorted');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(actions.update.mutate).toHaveBeenCalledWith('dismiss');
    expect(push).toHaveBeenCalledWith('/library/liked');
  });

  it('with no transfer, says there is nothing to check', () => {
    state.job = null;
    render(<TransferReview />);
    expect(screen.getByRole('heading', { name: 'Nothing to check' })).toBeInTheDocument();
  });
});
