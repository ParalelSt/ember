import { Suspense, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { SessionState, Track } from '@/types/track';

// The live carlist page wiring: the search's add choice reaches the server
// with its position and the toast says where the song landed.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const midnight: Track = {
  id: 'youtube:ddddddddddd',
  source: 'youtube',
  sourceId: 'ddddddddddd',
  title: 'Midnight City',
  artist: 'M83',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 240,
  artworkUrl: null,
  streamUrl: '',
};

// One search result, rendered through the page's own renderAdd.
vi.mock('@/components/track/menus/TrackSearchPicker', () => ({
  TrackSearchPicker: ({ renderAdd }: { renderAdd: (t: Track, added: boolean) => ReactNode }) => (
    <div data-testid="picker">{renderAdd(midnight, false)}</div>
  ),
}));
vi.mock('@/components/session/CarlistShare', () => ({
  CarlistShareDialog: ({ open, code }: { open: boolean; code: string }) => (open ? <div data-testid="share">{code}</div> : null),
}));
vi.mock('@/hooks/useSessionHost', () => ({ useSessionHost: vi.fn() }));
vi.mock('@/hooks/useCarlistProgress', () => ({ useCarlistProgress: () => 0.25 }));

const mutateAsync = vi.hoisted(() => vi.fn());
const data: SessionState = {
  session: {
    id: 's1',
    code: 'K7MPQ4',
    name: 'Road trip',
    active: true,
    nowIndex: 0,
    hostName: 'Hana',
    hostId: 'u1',
    isHost: false,
    viewerId: 'u2',
    nowElapsedMs: 1000,
  },
  members: [{ id: 'u1', name: 'Hana', avatarUrl: null }],
  queue: [],
};
const idle = { mutate: vi.fn(), isPending: false };
vi.mock('@/hooks/useSession', () => ({
  useQuerySession: () => ({ data, isLoading: false, error: null, dataUpdatedAt: 1 }),
  useExecuteAddToSession: () => ({ mutateAsync, isPending: false }),
  useExecuteSkipSession: () => idle,
  useExecuteEndSession: () => idle,
  useExecuteSaveSession: () => idle,
}));

const { default: SessionPage } = await import('./page');

const PARAMS = Object.assign(Promise.resolve({ id: 's1' }), { status: 'fulfilled', value: { id: 's1' } });

async function open() {
  await act(async () => {
    render(
      <Suspense fallback={null}>
        <SessionPage params={PARAMS} />
      </Suspense>,
    );
  });
}

beforeEach(() => vi.clearAllMocks());

describe('/session/[id] adding a song', () => {
  it('Play next: sent as position next, toast says it plays next', async () => {
    mutateAsync.mockResolvedValue({ ok: true, position: 'next', ahead: 0 });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Add Midnight City' }));
    fireEvent.click(screen.getByRole('button', { name: 'Play Midnight City next' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Added "Midnight City", plays next'));
    expect(mutateAsync).toHaveBeenCalledWith({ track: midnight, position: 'next' });
  });

  it('Add to end: toast says its place in line', async () => {
    mutateAsync.mockResolvedValue({ ok: true, position: 'end', ahead: 3 });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Add Midnight City' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Midnight City to the end' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Added "Midnight City", 4th in line'));
    expect(mutateAsync).toHaveBeenCalledWith({ track: midnight, position: 'end' });
  });

  it('a failed add says so', async () => {
    mutateAsync.mockRejectedValue(new Error('nope'));
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Add Midnight City' }));
    fireEvent.click(screen.getByRole('button', { name: 'Play Midnight City next' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
  });

  it('the code chip opens the share (QR and link)', async () => {
    await open();
    expect(screen.queryByTestId('share')).toBeNull();
    fireEvent.click(screen.getByTestId('code-chip'));
    expect(screen.getByTestId('share')).toHaveTextContent('K7MPQ4');
  });
});
