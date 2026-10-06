import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { CollabState } from '@/lib/collab';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'olga' } }) }));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
vi.mock('@/components/track/ShareButton', () => ({ legacyCopy: () => false }));

const calls: string[] = [];
const collab = vi.hoisted(() => ({ state: undefined as CollabState | undefined }));
const mutation = (name: string, result: (arg: unknown) => unknown) => ({
  mutate: vi.fn((arg: unknown, opts?: { onSuccess?: (r: unknown) => void }) => {
    calls.push(`${name}(${String(arg)})`);
    opts?.onSuccess?.(result(arg));
  }),
  mutateAsync: vi.fn(async (arg: unknown) => {
    calls.push(`${name}(${String(arg)})`);
    return result(arg);
  }),
  isPending: false,
});
let actions: Record<string, ReturnType<typeof mutation>>;
vi.mock('@/hooks/usePlaylistCollab', () => ({
  useQueryPlaylistCollab: () => ({ data: collab.state, error: null }),
  useQueryPlaylistPeople: () => ({ data: undefined, isLoading: false }),
  usePlaylistCollabActions: () => ({ ...actions, busy: false }),
}));

const { useCollaborateSheet } = await import('./useCollaborateSheet');

const olga = { id: 'olga', name: 'Olga', avatarUrl: null };
const xan = { id: 'xan', name: 'Xan', avatarUrl: null };
const state = (patch: Partial<CollabState> = {}): CollabState => ({
  collaborative: false,
  role: 'owner',
  owner: olga,
  members: [],
  maxMembers: 50,
  inviteCode: null,
  ...patch,
});
const writeText = vi.fn(async (text: string) => {
  calls.push(`copy(${text})`);
});

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  actions = {
    setCollaborative: mutation('collaborative', (on) => state({ collaborative: on as boolean })),
    newInvite: mutation('newInvite', () => ({ inviteCode: 'N'.repeat(32) })),
    stopInvite: mutation('stopInvite', () => ({ inviteCode: null })),
    addMember: mutation('add', () => ({ members: [xan] })),
    removeMember: mutation('remove', () => ({ ok: true })),
  };
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

describe('useCollaborateSheet', () => {
  it('Copy invite link on a private playlist: shares it, makes a link, copies it', async () => {
    collab.state = state();
    const { result } = renderHook(() => useCollaborateSheet('pl1', true));
    await act(async () => {
      await result.current.onShareLink();
    });
    expect(calls).toEqual(['collaborative(true)', 'newInvite(undefined)', `copy(${window.location.origin}/playlist/join/${'N'.repeat(32)})`]);
    expect(toast.success).toHaveBeenCalledWith('Sharing is on. Invite link copied');
  });

  it('already shared with no link: only makes and copies one', async () => {
    collab.state = state({ collaborative: true });
    const { result } = renderHook(() => useCollaborateSheet('pl1', true));
    await act(async () => {
      await result.current.onShareLink();
    });
    expect(calls).toEqual(['newInvite(undefined)', `copy(${window.location.origin}/playlist/join/${'N'.repeat(32)})`]);
    expect(toast.success).toHaveBeenCalledWith('Invite link copied');
  });

  it('a failed share says so and copies nothing', async () => {
    collab.state = state();
    actions.newInvite.mutateAsync.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useCollaborateSheet('pl1', true));
    await act(async () => {
      await result.current.onShareLink();
    });
    expect(calls).not.toContainEqual(expect.stringMatching(/^copy/));
    expect(toast.error).toHaveBeenCalledWith('Couldn’t make a link: boom');
  });

  it('Add by name on a private playlist shares it first, then adds them', async () => {
    collab.state = state();
    const { result } = renderHook(() => useCollaborateSheet('pl1', true));
    await act(async () => {
      await result.current.onAdd(xan);
    });
    expect(calls).toEqual(['collaborative(true)', 'add(xan)']);
    expect(toast.success).toHaveBeenCalledWith('Added Xan');
  });

  it('Add by name on a shared playlist just adds them', async () => {
    collab.state = state({ collaborative: true });
    const { result } = renderHook(() => useCollaborateSheet('pl1', true));
    await act(async () => {
      await result.current.onAdd(xan);
    });
    expect(calls).toEqual(['add(xan)']);
  });

  it('Stop sharing turns collaboration off', () => {
    collab.state = state({ collaborative: true, inviteCode: 'A'.repeat(32) });
    const { result } = renderHook(() => useCollaborateSheet('pl1', true));
    act(() => result.current.onStopSharing());
    expect(calls).toEqual(['collaborative(false)']);
    expect(toast.success).toHaveBeenCalledWith('Sharing is off');
  });
});
