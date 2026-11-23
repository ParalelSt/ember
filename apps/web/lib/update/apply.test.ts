import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PAUSED_GRACE_MS,
  RESUME_FRESH_MS,
  checkForUpdates,
  noteAppUpdateState,
  performUpdate,
  requestUpdate,
  resetUpdateForTests,
  setApplyDepsForTests,
  setPlaybackElsewhereProbe,
  setUpdatePause,
  takeUpdateResume,
  updateAtSongEnd,
  watchPendingUpdate,
} from './apply';
import { resetDeviceInfoForTests } from '@/lib/versions/device';
import { IDLE_UPDATE_STATE } from '@/lib/appUpdate';
import { makeTrack } from '@/test-utils/fakeBackend';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { INITIAL_UPDATE_STATE, useUpdateStore } from '@/stores/useUpdateStore';

/** Bringing an update in without ever stopping a song: a tap updates at once
 *  when nothing plays, else in the gap after the song, and the next song
 *  starts by itself once the page is back. */

const reload = vi.fn();
const installDesktop = vi.fn(async (_note: string | null) => true);
const downloadDesktop = vi.fn(async () => true);
const installAndroid = vi.fn(async () => true);
const downloadAndroid = vi.fn(async () => true);
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
  setApplyDepsForTests({ reload, installDesktop, downloadDesktop, installAndroid, downloadAndroid, openInstallSettings: openSettings });
  reload.mockClear();
  installAndroid.mockClear();
  downloadAndroid.mockClear();
  openSettings.mockClear();
  installDesktop.mockClear();
  installDesktop.mockImplementation(async () => true);
  downloadDesktop.mockClear();
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
    expect(installDesktop).not.toHaveBeenCalled();
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

  it('the desktop app downloads at the tap and installs at the end of the song, with the note', async () => {
    offer('shell');
    playing(true);
    expect(requestUpdate()).toBe('after-song');
    expect(downloadDesktop).toHaveBeenCalledTimes(1);
    expect(installDesktop).not.toHaveBeenCalled();
    expect(updateAtSongEnd({ index: 2, trackId: 'c' })).toBe(true);
    await vi.waitFor(() => expect(installDesktop).toHaveBeenCalledTimes(1));
    expect(JSON.parse(installDesktop.mock.calls[0][0] as string)).toMatchObject({ index: 2, trackId: 'c' });
    expect(reload).not.toHaveBeenCalled();
  });

  it('the desktop app installs at once when nothing plays', async () => {
    offer('shell');
    expect(requestUpdate()).toBe('now');
    await vi.waitFor(() => expect(installDesktop).toHaveBeenCalledTimes(1));
    expect(downloadDesktop).not.toHaveBeenCalled();
  });

  it('an install that could not start says so and forgets the note', async () => {
    installDesktop.mockImplementation(async () => false);
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

  it('a tap while a song plays downloads now and installs nothing, even though the app plays it', () => {
    androidOffer();
    playing(true);
    // The Android app plays the music itself: a web reload would go ahead,
    // an app install must not.
    setPlaybackElsewhereProbe(() => true);
    expect(requestUpdate()).toBe('after-song');
    expect(downloadAndroid).toHaveBeenCalledTimes(1);
    expect(installAndroid).not.toHaveBeenCalled();
  });

  it('the next song showing up is the gap: it is paused, the install starts, and that song is noted', async () => {
    const pause = vi.fn();
    setUpdatePause(pause);
    androidOffer();
    playing(true);
    const stop = watchPendingUpdate();
    requestUpdate();
    usePlayerStore.setState({ index: 1 });
    await vi.waitFor(() => expect(installAndroid).toHaveBeenCalledTimes(1));
    expect(pause).toHaveBeenCalled();
    expect(takeUpdateResume([A, B])).toEqual({ index: 1, trackId: B.id });
    stop();
  });

  it('the install hands the app the resume note, which survives the app being replaced', async () => {
    androidOffer();
    playing(true);
    const stop = watchPendingUpdate();
    requestUpdate();
    usePlayerStore.setState({ index: 1 });
    await vi.waitFor(() => expect(installAndroid).toHaveBeenCalledTimes(1));
    const note = (installAndroid.mock.calls[0] as unknown as [string])[0];
    expect(JSON.parse(note)).toMatchObject({ index: 1, trackId: B.id });
    stop();
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
