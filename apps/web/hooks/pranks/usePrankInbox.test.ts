import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { POLL_IDLE_MS, POLL_PLAYING_MS, usePrankInbox, type PrankInboxDeps, type PrankSubscribe } from './usePrankInbox';
import type { PrankAck, PrankRow } from '@/lib/pranks/types';

const ping = (id: string): PrankRow => ({
  id, kind: 'ping', streamUrl: null, expiresAt: '2099-01-01 00:00:00.000Z',
  params: { durationSec: 0, volume: 1, mode: 'over', startFrom: 'start' },
});
const DELIVERED: PrankAck = { status: 'delivered', engine: 'web' };

/** Lets queued promise callbacks run under fake timers. */
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

function fakeDeps(subscribe: PrankSubscribe | null = null) {
  const inbox: PrankRow[] = [];
  const deps = {
    fetchInbox: vi.fn<() => Promise<PrankRow[]>>(async () => [...inbox]),
    ack: vi.fn<(id: string, body: PrankAck) => Promise<unknown>>(async () => ({ ok: true })),
    subscribe,
  };
  return { inbox, deps: deps as PrankInboxDeps & typeof deps };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('usePrankInbox (poll)', () => {
  it('fetches at once, acks what receive returns, and handles each prank once', async () => {
    const { inbox, deps } = fakeDeps();
    inbox.push(ping('p1'));
    const receive = vi.fn(() => DELIVERED);
    renderHook(() => usePrankInbox({ userId: 'u1', isPlaying: true, receive, deps }));
    await flush();
    expect(receive).toHaveBeenCalledWith(ping('p1'));
    expect(deps.ack).toHaveBeenCalledWith('p1', DELIVERED);

    await act(async () => { vi.advanceTimersByTime(POLL_PLAYING_MS); });
    await flush();
    expect(deps.fetchInbox).toHaveBeenCalledTimes(2);
    expect(receive).toHaveBeenCalledTimes(1);
  });

  it('polls every 2.5 s while playing and every 10 s when not', async () => {
    const { deps } = fakeDeps();
    const { rerender } = renderHook((p: { isPlaying: boolean }) =>
      usePrankInbox({ userId: 'u1', isPlaying: p.isPlaying, receive: () => null, deps }), { initialProps: { isPlaying: false } });
    await flush();
    expect(deps.fetchInbox).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(POLL_PLAYING_MS); });
    await flush();
    expect(deps.fetchInbox).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(POLL_IDLE_MS - POLL_PLAYING_MS); });
    await flush();
    expect(deps.fetchInbox).toHaveBeenCalledTimes(2);

    rerender({ isPlaying: true });
    await flush();
    expect(deps.fetchInbox).toHaveBeenCalledTimes(3);
    await act(async () => { vi.advanceTimersByTime(POLL_PLAYING_MS); });
    await flush();
    expect(deps.fetchInbox).toHaveBeenCalledTimes(4);
  });

  it('sends no ack when receive returns null, and does nothing signed out', async () => {
    const { inbox, deps } = fakeDeps();
    inbox.push(ping('late'));
    renderHook(() => usePrankInbox({ userId: 'u1', isPlaying: true, receive: () => null, deps }));
    await flush();
    expect(deps.ack).not.toHaveBeenCalled();

    const other = fakeDeps();
    renderHook(() => usePrankInbox({ userId: null, isPlaying: true, receive: () => DELIVERED, deps: other.deps }));
    await flush();
    expect(other.deps.fetchInbox).not.toHaveBeenCalled();
  });

  it('swallows a failing fetch or ack and keeps polling', async () => {
    const { inbox, deps } = fakeDeps();
    deps.fetchInbox.mockRejectedValueOnce(new Error('offline'));
    deps.ack.mockRejectedValue(new Error('410'));
    renderHook(() => usePrankInbox({ userId: 'u1', isPlaying: true, receive: () => DELIVERED, deps }));
    await flush();
    inbox.push(ping('p2'));
    await act(async () => { vi.advanceTimersByTime(POLL_PLAYING_MS); });
    await flush();
    expect(deps.ack).toHaveBeenCalledWith('p2', DELIVERED);
  });
});

describe('usePrankInbox (realtime)', () => {
  function fakeRealtime() {
    const link: { onRow?: (r: PrankRow) => void; onConnect?: () => void; onDisconnect?: () => void; off: ReturnType<typeof vi.fn<() => void>>; userId?: string } = { off: vi.fn<() => void>() };
    const subscribe: PrankSubscribe = (userId, onRow, onConnect, onDisconnect) => {
      Object.assign(link, { userId, onRow, onConnect, onDisconnect });
      return link.off;
    };
    return { link, subscribe };
  }

  it('subscribes for this user, handles pushed rows, and stops polling while live', async () => {
    const { link, subscribe } = fakeRealtime();
    const { inbox, deps } = fakeDeps(subscribe);
    const receive = vi.fn((_row: PrankRow) => DELIVERED);
    const { unmount } = renderHook(() => usePrankInbox({ userId: 'u1', isPlaying: true, receive, deps }));
    await flush();
    expect(link.userId).toBe('u1');
    const before = deps.fetchInbox.mock.calls.length;

    // Connect: one catch-up fetch, then no more polling.
    inbox.push(ping('missed'));
    await act(async () => { link.onConnect!(); });
    await flush();
    expect(deps.fetchInbox).toHaveBeenCalledTimes(before + 1);
    expect(deps.ack).toHaveBeenCalledWith('missed', DELIVERED);
    await act(async () => { vi.advanceTimersByTime(POLL_PLAYING_MS * 3); });
    await flush();
    expect(deps.fetchInbox).toHaveBeenCalledTimes(before + 1);

    // A pushed row, and the same row again from a later poll: handled once.
    await act(async () => { link.onRow!(ping('pushed')); });
    await flush();
    expect(deps.ack).toHaveBeenCalledWith('pushed', DELIVERED);

    // Link drops: the poll takes over.
    inbox.push(ping('pushed'));
    await act(async () => { link.onDisconnect!(); vi.advanceTimersByTime(POLL_PLAYING_MS); });
    await flush();
    expect(deps.fetchInbox).toHaveBeenCalledTimes(before + 2);
    expect(receive.mock.calls.filter(([r]) => r.id === 'pushed')).toHaveLength(1);

    unmount();
    expect(link.off).toHaveBeenCalled();
  });
});
