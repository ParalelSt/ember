import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const setContext = vi.hoisted(() => vi.fn());
const shell = vi.hoisted(() => ({ version: null as string | null | Promise<string | null> }));
vi.mock('@/lib/logger/client', () => ({ logger: { setContext } }));
vi.mock('@/lib/shellVersion', () => ({ shellAppVersion: async () => shell.version }));

const { deviceId, detectDevicePlatform, loadDeviceInfo, reportDeviceSeen, resetDeviceInfoForTests, SEEN_EVERY_MS } = await import('./device');

const NOW = Date.UTC(2026, 9, 30, 12);
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetDeviceInfoForTests();
  localStorage.clear();
  setContext.mockReset();
  shell.version = null;
  vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '0.7.34 (a1b2c3d 2026-10-22)');
  fetchMock = vi.fn(async () => Response.json({ ok: true, saved: true }));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as unknown as Record<string, unknown>).Capacitor;
  delete (window as unknown as Record<string, unknown>).__TAURI__;
});

function inPhoneApp(platform: string) {
  (window as unknown as Record<string, unknown>).Capacitor = { isNativePlatform: () => true, getPlatform: () => platform };
}

describe('detectDevicePlatform', () => {
  it('a plain page is a browser', () => {
    expect(detectDevicePlatform()).toBe('browser');
  });

  it('tells the phone apps apart', () => {
    inPhoneApp('android');
    expect(detectDevicePlatform()).toBe('android');
    inPhoneApp('ios');
    expect(detectDevicePlatform()).toBe('ios');
  });

  it('tells the desktop apps apart', () => {
    (window as unknown as Record<string, unknown>).__TAURI__ = {};
    const ua = vi.spyOn(navigator, 'userAgent', 'get');
    ua.mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
    expect(detectDevicePlatform()).toBe('windows');
    ua.mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    expect(detectDevicePlatform()).toBe('macos');
    ua.mockReturnValue('Mozilla/5.0 (X11; Linux x86_64)');
    expect(detectDevicePlatform()).toBe('linux');
  });
});

describe('loadDeviceInfo', () => {
  it('cleans the web stamp and hands the shell half to the logger', async () => {
    inPhoneApp('android');
    shell.version = '0.4.28';
    await expect(loadDeviceInfo()).resolves.toEqual({ platform: 'android', shellVersion: '0.4.28', webVersion: '0.7.34' });
    expect(setContext).toHaveBeenCalledWith({ shellPlatform: 'android', shellVersion: '0.4.28' });
  });

  it('asks once', async () => {
    const a = loadDeviceInfo();
    expect(loadDeviceInfo()).toBe(a);
  });

  it('a logger that fails does not get in the way', async () => {
    setContext.mockImplementation(() => {
      throw new Error('no');
    });
    await expect(loadDeviceInfo()).resolves.toMatchObject({ platform: 'browser' });
  });

  it('does not wait forever for a shell that never answers', async () => {
    vi.useFakeTimers();
    try {
      inPhoneApp('android');
      shell.version = new Promise(() => {});
      const p = loadDeviceInfo();
      await vi.advanceTimersByTimeAsync(2000);
      await expect(p).resolves.toMatchObject({ platform: 'android', shellVersion: null });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('deviceId', () => {
  it('makes one id and keeps it', () => {
    const id = deviceId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(deviceId()).toBe(id);
  });

  it('replaces a stored value that is not an id', () => {
    localStorage.setItem('ember.device.id', '<script>');
    expect(deviceId()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('without storage, every load is the same row', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked');
      },
    });
    expect(deviceId()).toBe('no-storage');
    expect(deviceId()).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
});

describe('reportDeviceSeen', () => {
  it('sends what the device runs, and nothing else', async () => {
    expect(await reportDeviceSeen('u1', NOW)).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/devices/seen');
    expect(JSON.parse(init.body as string)).toEqual({
      deviceId: deviceId(),
      platform: 'browser',
      shellVersion: null,
      webVersion: '0.7.34',
    });
  });

  it('stays quiet until the time is up', async () => {
    await reportDeviceSeen('u1', NOW);
    expect(await reportDeviceSeen('u1', NOW + SEEN_EVERY_MS - 1)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await reportDeviceSeen('u1', NOW + SEEN_EVERY_MS)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('sends at once when the version changed', async () => {
    await reportDeviceSeen('u1', NOW);
    resetDeviceInfoForTests();
    vi.stubEnv('NEXT_PUBLIC_APP_VERSION', '0.7.35 (b 2026-10-30)');
    expect(await reportDeviceSeen('u1', NOW + 1000)).toBe(true);
  });

  it('sends at once for another member on the same device', async () => {
    await reportDeviceSeen('u1', NOW);
    expect(await reportDeviceSeen('u2', NOW + 1000)).toBe(true);
  });

  it('a clock that went back does not silence it', async () => {
    await reportDeviceSeen('u1', NOW);
    expect(await reportDeviceSeen('u1', NOW - 1000)).toBe(true);
  });

  it('failures are silent and try again next time', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(reportDeviceSeen('u1', NOW)).resolves.toBe(false);
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));
    await expect(reportDeviceSeen('u1', NOW)).resolves.toBe(false);
    fetchMock.mockResolvedValueOnce(new Response('<html>sign in</html>'));
    await expect(reportDeviceSeen('u1', NOW)).resolves.toBe(false);
    fetchMock.mockResolvedValueOnce(Response.json({ ok: false }));
    await expect(reportDeviceSeen('u1', NOW)).resolves.toBe(false);
    await expect(reportDeviceSeen('u1', NOW)).resolves.toBe(true);
  });

  it('does not try while offline', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(await reportDeviceSeen('u1', NOW)).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('one note at a time', async () => {
    let release: (r: Response) => void = () => {};
    fetchMock.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const first = reportDeviceSeen('u1', NOW);
    expect(await reportDeviceSeen('u1', NOW)).toBe(false);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    release(Response.json({ ok: true }));
    expect(await first).toBe(true);
  });
});
