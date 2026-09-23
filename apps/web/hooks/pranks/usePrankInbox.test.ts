import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { POLL_IDLE_MS, POLL_PLAYING_MS, usePrankInbox, type PrankInboxDeps, type PrankSubscribe } from './usePrankInbox';
import { decidePrank } from '@/lib/pranks/decide';
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

  it('sends a receipt\'s ack first and its follow-up only after that one landed', async () => {
    const { inbox, deps } = fakeDeps();
    inbox.push(ping('s1'));
    let finish!: (a: PrankAck) => void;
    const then = new Promise<PrankAck>((r) => (finish = r));
    let releaseFirst!: () => void;
    deps.ack.mockImplementationOnce(() => new Promise((r) => (releaseFirst = () => r({ ok: true }))));
    renderHook(() => usePrankInbox({ userId: 'u1', isPlaying: true, receive: () => ({ ack: DELIVERED, then }), deps }));
    await flush();
    expect(deps.ack).toHaveBeenCalledTimes(1);
    expect(deps.ack).toHaveBeenCalledWith('s1', DELIVERED);

    // The sound finishes before the first ack is back: the follow-up waits.
    finish({ status: 'done', playedSec: 2 });
    await flush();
    expect(deps.ack).toHaveBeenCalledTimes(1);
    releaseFirst();
    await flush();
    expect(deps.ack).toHaveBeenLastCalledWith('s1', { status: 'done', playedSec: 2 });
    expect(deps.ack).toHaveBeenCalledTimes(2);
  });

  it('sends no follow-up when the receipt\'s follow-up is null, or when the first ack failed', async () => {
    const { inbox, deps } = fakeDeps();
    inbox.push(ping('s1'), ping('s2'));
    deps.ack.mockImplementation(async (id: string) => {
      if (id === 's2') throw new Error('offline');
      return { ok: true };
    });
    const done: PrankAck = { status: 'done', playedSec: 1 };
    renderHook(() => usePrankInbox({
      userId: 'u1', isPlaying: true, deps,
      receive: (row) => ({ ack: DELIVERED, then: Promise.resolve(row.id === 's1' ? null : done) }),
    }));
    await flush();
    expect(deps.ack.mock.calls).toEqual([['s1', DELIVERED], ['s2', DELIVERED]]);
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

  it('a prank left for later is not acked, and is offered again on the next poll', async () => {
    const { inbox, deps } = fakeDeps();
    inbox.push(ping('s1'));
    const receive = vi.fn<(row: PrankRow) => PrankAck | 'later'>(() => 'later');
    renderHook(() => usePrankInbox({ userId: 'u1', isPlaying: false, receive, deps }));
    await flush();
    expect(receive).toHaveBeenCalledTimes(1);
    expect(deps.ack).not.toHaveBeenCalled();

    // The music starts here within the window: this device takes it.
    receive.mockImplementation(() => DELIVERED);
    await act(async () => { vi.advanceTimersByTime(POLL_IDLE_MS); });
    await flush();
    expect(receive).toHaveBeenCalledTimes(2);
    expect(deps.ack).toHaveBeenCalledWith('s1', DELIVERED);
  });

  it('an idle second device never swallows the sound meant for the one playing', async () => {
    // One server inbox; an ack moves the row out of pending.
    const server: PrankRow[] = [{ ...ping('s1'), kind: 'sound', streamUrl: '/api/pranks/media/x' }];
    const pending = () => server.filter((r) => !acked.has(r.id));
    const acked = new Map<string, PrankAck>();
    // Each device decides the way PrankReceiver does.
    const device = (playing: boolean) => ({
      fetchInbox: vi.fn(async () => pending()),
      ack: vi.fn(async (id: string, body: PrankAck) => void acked.set(id, body)),
      subscribe: null,
      receive: vi.fn((row: PrankRow): PrankAck | 'later' | null => {
        const a = decidePrank(row, { isPlaying: playing, hasTrack: true, engine: 'web', busy: false, pluginHasOverlay: false, now: Date.now() });
        if (a.type === 'sound') return DELIVERED;
        if (a.type === 'skip') return { status: 'skipped', reason: a.reason };
        return a.type === 'ignore' ? null : 'later';
      }),
    });
    const idle = device(false);
    const phone = device(true);
    // The idle tab looks first.
    renderHook(() => usePrankInbox({ userId: 'u1', isPlaying: false, receive: idle.receive, deps: idle }));
    await flush();
    renderHook(() => usePrankInbox({ userId: 'u1', isPlaying: true, receive: phone.receive, deps: phone }));
    await flush();
    expect(idle.ack).not.toHaveBeenCalled();
    expect(acked.get('s1')).toEqual(DELIVERED);
    expect(phone.receive).toHaveBeenCalledTimes(1);
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
    const receive = vi.fn<(row: PrankRow) => PrankAck>(() => DELIVERED);
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
