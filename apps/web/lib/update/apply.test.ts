import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PAUSED_GRACE_MS,
  RESUME_FRESH_MS,
  checkForUpdates,
  performUpdate,
  requestUpdate,
  resetUpdateForTests,
  setApplyDepsForTests,
  setPlaybackElsewhereProbe,
  takeUpdateResume,
  updateAtSongEnd,
  watchPendingUpdate,
} from './apply';
import { resetDeviceInfoForTests } from '@/lib/versions/device';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { INITIAL_UPDATE_STATE, useUpdateStore } from '@/stores/useUpdateStore';

/** Bringing an update in without ever stopping a song: a tap updates at once
 *  when nothing plays, else in the gap after the song, and the next song
 *  starts by itself once the page is back. */

const reload = vi.fn();
const restartShell = vi.fn(async () => true);

function offer(kind: 'web' | 'shell' = 'web', canApply = true) {
  useUpdateStore.getState().set({ status: 'available', offer: { kind, version: kind === 'web' ? '0.7.44' : '0.4.27', canApply } });
}

function playing(on: boolean) {
  usePlayerStore.setState({ isPlaying: on });
}

function setOnline(on: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
}

beforeEach(() => {
  resetUpdateForTests();
  useUpdateStore.setState({ ...INITIAL_UPDATE_STATE });
  setApplyDepsForTests({ reload, restartShell });
  reload.mockClear();
  restartShell.mockClear();
  restartShell.mockImplementation(async () => true);
  playing(false);
  setOnline(true);
});

afterEach(() => {
  vi.useRealTimers();
  resetUpdateForTests();
});

describe('requestUpdate', () => {
  it('reloads at once when nothing is playing', () => {
    offer();
    expect(requestUpdate()).toBe('now');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('waits for the song to end while one plays, and never reloads under it', () => {
    offer();
    playing(true);
    expect(requestUpdate()).toBe('after-song');
    expect(useUpdateStore.getState().pending).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it('goes ahead when the music plays somewhere a reload cannot stop', () => {
    offer();
    playing(true);
    setPlaybackElsewhereProbe(() => true);
    expect(requestUpdate()).toBe('now');
    expect(reload).toHaveBeenCalled();
  });

  it('waits while offline: a reload with no host is a blank page', () => {
    offer();
    setOnline(false);
    expect(requestUpdate()).toBe('waiting-online');
    expect(reload).not.toHaveBeenCalled();
  });

  it('does nothing without an update the page can bring in', () => {
    expect(requestUpdate()).toBe('none');
    offer('shell', false);
    expect(requestUpdate()).toBe('none');
    expect(reload).not.toHaveBeenCalled();
    expect(restartShell).not.toHaveBeenCalled();
  });
});

describe('updateAtSongEnd', () => {
  it('does nothing when no update waits: the next song plays as usual', () => {
    offer();
    expect(updateAtSongEnd({ index: 1, trackId: 'b' })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads in the gap and notes the next song to start once back', () => {
    offer();
    playing(true);
    requestUpdate();
    expect(updateAtSongEnd({ index: 1, trackId: 'b' })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(takeUpdateResume([{ id: 'a' }, { id: 'b' }])).toEqual({ index: 1, trackId: 'b' });
  });

  it('restarts the desktop app for an app update, with the same note', async () => {
    offer('shell');
    playing(true);
    requestUpdate();
    expect(updateAtSongEnd({ index: 2, trackId: 'c' })).toBe(true);
    await vi.waitFor(() => expect(restartShell).toHaveBeenCalled());
    expect(reload).not.toHaveBeenCalled();
  });

  it('an app that cannot restart itself says so and forgets the note', async () => {
    restartShell.mockImplementation(async () => false);
    offer('shell');
    expect(await performUpdate({ index: 1, trackId: 'b' })).toBe(false);
    expect(useUpdateStore.getState().applyFailed).toBe(true);
    expect(takeUpdateResume([{ id: 'a' }, { id: 'b' }])).toBeNull();
  });
});

describe('takeUpdateResume', () => {
  it('is read once', () => {
    offer();
    void performUpdate({ index: 0, trackId: 'a' });
    expect(takeUpdateResume([{ id: 'a' }])).not.toBeNull();
    expect(takeUpdateResume([{ id: 'a' }])).toBeNull();
  });

  it('ignores a note for another queue', () => {
    offer();
    void performUpdate({ index: 0, trackId: 'a' });
    expect(takeUpdateResume([{ id: 'x' }])).toBeNull();
  });

  it('ignores an old note', () => {
    offer();
    const then = 5_000_000;
    void performUpdate({ index: 0, trackId: 'a' }, then);
    expect(takeUpdateResume([{ id: 'a' }], then + RESUME_FRESH_MS + 1)).toBeNull();
  });
});

describe('watchPendingUpdate', () => {
  it('goes ahead once the music is paused for a moment', () => {
    vi.useFakeTimers();
    offer();
    playing(true);
    const stop = watchPendingUpdate();
    requestUpdate();
    playing(false);
    vi.advanceTimersByTime(PAUSED_GRACE_MS - 10);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it('a pause that ends at once (the gap between songs) does not count', () => {
    vi.useFakeTimers();
    offer();
    playing(true);
    const stop = watchPendingUpdate();
    requestUpdate();
    playing(false);
    vi.advanceTimersByTime(500);
    playing(true);
    vi.advanceTimersByTime(PAUSED_GRACE_MS * 2);
    expect(reload).not.toHaveBeenCalled();
    stop();
  });
});

describe('checkForUpdates', () => {
  beforeEach(() => resetDeviceInfoForTests());

  it('records the host web version as an offer when it is newer than the running build', async () => {
    const running = process.env.NEXT_PUBLIC_APP_VERSION;
    process.env.NEXT_PUBLIC_APP_VERSION = '0.7.42 (abc 2026-11-12)';
    try {
      const f = vi.fn(async () => new Response(JSON.stringify({ version: '0.7.43 (def 2026-11-13)' }), { status: 200 }));
      await checkForUpdates(f as unknown as typeof fetch);
      const s = useUpdateStore.getState();
      expect(s.status).toBe('available');
      expect(s.offer).toEqual({ kind: 'web', version: '0.7.43', canApply: true });
      expect(s.checkedAt).toBeGreaterThan(0);
    } finally {
      process.env.NEXT_PUBLIC_APP_VERSION = running;
    }
  });

  it('a failed check keeps what an earlier one found', async () => {
    offer();
    const f = vi.fn(async () => new Response('down', { status: 502 }));
    await checkForUpdates(f as unknown as typeof fetch);
    expect(useUpdateStore.getState().status).toBe('failed');
    expect(useUpdateStore.getState().offer?.version).toBe('0.7.44');
  });
});
