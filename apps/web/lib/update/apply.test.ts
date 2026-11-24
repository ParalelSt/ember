import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RESUME_FRESH_MS,
  checkForUpdates,
  noteAppUpdateState,
  performUpdate,
  requestUpdate,
  resetUpdateForTests,
  setApplyDepsForTests,
  takeUpdateResume,
  watchPendingUpdate,
} from './apply';
import { resetDeviceInfoForTests } from '@/lib/versions/device';
import { IDLE_UPDATE_STATE } from '@/lib/appUpdate';
import { makeTrack } from '@/test-utils/fakeBackend';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { INITIAL_UPDATE_STATE, useUpdateStore } from '@/stores/useUpdateStore';

/** Bringing an update in: a tap updates at once, even while a song plays
 *  (the song and its position are kept and start again once the page is
 *  back); offline it waits for the host. */

const reload = vi.fn();
const installDesktop = vi.fn(async (_note: string | null) => true);
const installAndroid = vi.fn(async () => true);
const openSettings = vi.fn(async () => true);

function offer(kind: 'web' | 'shell' = 'web', canApply = true) {
  useUpdateStore.getState().set({ status: 'available', offer: { kind, version: kind === 'web' ? '0.7.44' : '0.4.27', canApply, via: kind === 'web' ? 'reload' : 'desktop' } });
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
  setApplyDepsForTests({ reload, installDesktop, installAndroid, openInstallSettings: openSettings });
  reload.mockClear();
  installAndroid.mockClear();
  openSettings.mockClear();
  installDesktop.mockClear();
  installDesktop.mockImplementation(async () => true);
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

  // The old rule waited for the song to end. The page only hears that from
  // its own engine, so repeat-one, the Android app's player and the like
  // never got there and the tap did nothing (root cause, owner 2026-11-24).
  it('a tap while a song plays updates at once and keeps the song and its position', () => {
    offer();
    usePlayerStore.setState({ queue: [makeTrack({ id: 'a' }), makeTrack({ id: 'b' })], index: 1, position: 83.7, isPlaying: true });
    expect(requestUpdate()).toBe('now');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(useUpdateStore.getState().pending).toBe(false);
    expect(takeUpdateResume([{ id: 'a' }, { id: 'b' }])).toEqual({ index: 1, trackId: 'b', positionSec: 83 });
  });

  it('a tap while a song plays on repeat-one still updates (the song never ends)', () => {
    offer();
    usePlayerStore.setState({ queue: [makeTrack({ id: 'a' })], index: 0, position: 10, isPlaying: true, loopMode: 'one' });
    expect(requestUpdate()).toBe('now');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('paused: nothing is noted, the player comes back on its saved queue', () => {
    offer();
    usePlayerStore.setState({ queue: [makeTrack({ id: 'a' })], index: 0, position: 10, isPlaying: false });
    expect(requestUpdate()).toBe('now');
    expect(takeUpdateResume([{ id: 'a' }])).toBeNull();
  });

  it('waits while offline: a reload with no host is a blank page', () => {
    offer();
    setOnline(false);
    expect(requestUpdate()).toBe('waiting-online');
    expect(useUpdateStore.getState().pending).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does nothing without an update the page can bring in', () => {
    expect(requestUpdate()).toBe('none');
    offer('shell', false);
    expect(requestUpdate()).toBe('none');
    expect(reload).not.toHaveBeenCalled();
    expect(installDesktop).not.toHaveBeenCalled();
  });

  it('the desktop app installs at once, even while a song plays, with the note', async () => {
    offer('shell');
    usePlayerStore.setState({ queue: [makeTrack({ id: 'a' }), makeTrack({ id: 'c' })], index: 1, position: 42, isPlaying: true });
    expect(requestUpdate()).toBe('now');
    await vi.waitFor(() => expect(installDesktop).toHaveBeenCalledTimes(1));
    expect(JSON.parse(installDesktop.mock.calls[0][0] as string)).toMatchObject({ index: 1, trackId: 'c', positionSec: 42 });
    expect(reload).not.toHaveBeenCalled();
  });

  it('an install that could not start says so and forgets the note', async () => {
    installDesktop.mockImplementation(async () => false);
    offer('shell');
    expect(await performUpdate({ index: 1, trackId: 'b' })).toBe(false);
    expect(useUpdateStore.getState().applyFailed).toBe(true);
    expect(takeUpdateResume([{ id: 'a' }, { id: 'b' }])).toBeNull();
  });

  it('a failed update can be tapped again', async () => {
    installDesktop.mockImplementation(async () => false);
    offer('shell');
    requestUpdate();
    await vi.waitFor(() => expect(useUpdateStore.getState().applyFailed).toBe(true));
    installDesktop.mockImplementation(async () => true);
    expect(requestUpdate()).toBe('now');
    await vi.waitFor(() => expect(installDesktop).toHaveBeenCalledTimes(2));
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

describe('watchPendingUpdate (a tap that waited for the host)', () => {
  it('goes ahead once the host is back, with the song playing then', () => {
    offer();
    setOnline(false);
    usePlayerStore.setState({ queue: [makeTrack({ id: 'a' })], index: 0, position: 30, isPlaying: true });
    const stop = watchPendingUpdate();
    requestUpdate();
    expect(reload).not.toHaveBeenCalled();
    setOnline(true);
    window.dispatchEvent(new Event('online'));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(takeUpdateResume([{ id: 'a' }])).toEqual({ index: 0, trackId: 'a', positionSec: 30 });
    stop();
  });

  it('does nothing while no tap is waiting', () => {
    offer();
    const stop = watchPendingUpdate();
    window.dispatchEvent(new Event('online'));
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
      expect(s.offer).toEqual({ kind: 'web', version: '0.7.43', canApply: true, via: 'reload' });
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

type W = Window & { Capacitor?: unknown };

describe('the Android app (0.4.34 on: it waits for a tap)', () => {
  const A = makeTrack({ id: 'youtube:a' });
  const B = makeTrack({ id: 'youtube:b' });

  beforeEach(() => {
    resetDeviceInfoForTests();
    (window as W).Capacitor = {
      isNativePlatform: () => true,
      getPlatform: () => 'android',
      Plugins: { EmberUpdate: { getState: vi.fn(async () => ({})), download: vi.fn(), check: vi.fn(async () => ({})) } },
    };
    usePlayerStore.setState({ queue: [A, B], index: 0 });
  });
  afterEach(() => {
    delete (window as W).Capacitor;
  });

  function androidOffer() {
    useUpdateStore.getState().set({ status: 'available', offer: { kind: 'shell', version: '0.4.34', canApply: true, via: 'android' } });
  }

  describe('one check at a time with the app\'s own start check', () => {
    const web = vi.fn(async () => new Response(JSON.stringify({ version: '0.0.1' }), { status: 200 }));
    function plugin(state: Record<string, unknown>) {
      const check = vi.fn(async () => ({}));
      (window as W).Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => 'android',
        Plugins: { EmberUpdate: { getState: vi.fn(async () => state), download: vi.fn(), check } },
      };
      return check;
    }

    it('the reminder\'s check leaves the app alone when the app has just checked', async () => {
      const check = plugin({ status: 'up-to-date', checkedAt: Date.now() - 15_000 });
      await checkForUpdates(web as unknown as typeof fetch);
      await new Promise((r) => setTimeout(r, 0));
      expect(check).not.toHaveBeenCalled();
      // The web build is still checked.
      expect(web).toHaveBeenCalled();
    });

    it('nor while the app is still checking', async () => {
      const check = plugin({ status: 'checking', checkedAt: 0 });
      await checkForUpdates(web as unknown as typeof fetch);
      await new Promise((r) => setTimeout(r, 0));
      expect(check).not.toHaveBeenCalled();
    });

    it('asks the app when its last answer is old (the 30 minute check)', async () => {
      const check = plugin({ status: 'up-to-date', checkedAt: Date.now() - 31 * 60_000 });
      await checkForUpdates(web as unknown as typeof fetch);
      await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    });

    it('a failed check of the app is not an answer: the reminder still asks', async () => {
      // The app stamps checkedAt before it reads the reply.
      for (const status of ['idle', 'failed']) {
        const check = plugin({ status, checkedAt: Date.now() - 15_000 });
        await checkForUpdates(web as unknown as typeof fetch);
        await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(1));
      }
    });

    it('a tap that lands during the reminder\'s own check still asks the app', async () => {
      const check = plugin({ status: 'up-to-date', checkedAt: Date.now() - 1000 });
      let answer!: (r: Response) => void;
      const slow = vi.fn(() => new Promise<Response>((r) => { answer = r; }));
      const auto = checkForUpdates(slow as unknown as typeof fetch);
      const tap = checkForUpdates(undefined, { manual: true });
      await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(1));
      answer(new Response(JSON.stringify({ version: '0.0.1' }), { status: 200 }));
      await Promise.all([auto, tap]);
      expect(check).toHaveBeenCalledTimes(1);
    });

    it('a tap on Check for updates always asks the app', async () => {
      const check = plugin({ status: 'up-to-date', checkedAt: Date.now() - 1000 });
      await checkForUpdates(web as unknown as typeof fetch, { manual: true });
      await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    });

    it('what the app found still becomes the offer', async () => {
      plugin({ status: 'available', current: '0.4.34', latest: '0.4.35', checkedAt: Date.now() - 1000 });
      await noteAppUpdateState({ ...IDLE_UPDATE_STATE, status: 'available', current: '0.4.34', latest: '0.4.35', checkedAt: Date.now() - 1000 });
      expect(useUpdateStore.getState().offer).toMatchObject({ kind: 'shell', version: '0.4.35' });
    });
  });

  it('a newer app found by the app becomes the offer', async () => {
    await noteAppUpdateState({ ...IDLE_UPDATE_STATE, status: 'available', current: '0.4.33', latest: '0.4.34' });
    expect(useUpdateStore.getState().offer).toEqual({ kind: 'shell', version: '0.4.34', canApply: true, via: 'android' });
    await noteAppUpdateState({ ...IDLE_UPDATE_STATE, status: 'up-to-date', current: '0.4.34', latest: '0.4.34' });
    expect(useUpdateStore.getState().offer).toBeNull();
  });

  it('a tap with nothing playing installs at once (the app downloads first)', () => {
    androidOffer();
    expect(requestUpdate()).toBe('now');
    return vi.waitFor(() => expect(installAndroid).toHaveBeenCalledTimes(1));
  });

  it('a tap while a song plays installs at once and hands the app the song and position', async () => {
    androidOffer();
    usePlayerStore.setState({ queue: [A, B], index: 1, position: 61, isPlaying: true });
    expect(requestUpdate()).toBe('now');
    await vi.waitFor(() => expect(installAndroid).toHaveBeenCalledTimes(1));
    const note = (installAndroid.mock.calls[0] as unknown as [string])[0];
    expect(JSON.parse(note)).toMatchObject({ index: 1, trackId: B.id, positionSec: 61 });
    expect(takeUpdateResume([A, B])).toEqual({ index: 1, trackId: B.id, positionSec: 61 });
  });

  it('an install the app could not do says so, and a tap tries again', async () => {
    androidOffer();
    installAndroid.mockImplementationOnce(async () => false);
    requestUpdate();
    await vi.waitFor(() => expect(useUpdateStore.getState().applyFailed).toBe(true));
    expect(requestUpdate()).toBe('now');
    await vi.waitFor(() => expect(installAndroid).toHaveBeenCalledTimes(2));
  });

  it('with "Install unknown apps" off, its settings open once, and back with it on the install goes ahead', async () => {
    androidOffer();
    requestUpdate();
    await vi.waitFor(() => expect(installAndroid).toHaveBeenCalledTimes(1));
    const waiting = { ...IDLE_UPDATE_STATE, status: 'ready' as const, current: '0.4.33', latest: '0.4.34' };
    await noteAppUpdateState({ ...waiting, waiting: 'permission' });
    await noteAppUpdateState({ ...waiting, waiting: 'permission' });
    expect(openSettings).toHaveBeenCalledTimes(1);
    await noteAppUpdateState({ ...waiting, waiting: 'tap' });
    expect(installAndroid).toHaveBeenCalledTimes(2);
  });
});
