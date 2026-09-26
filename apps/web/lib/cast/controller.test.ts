import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFakeCastGlobals } from '@/test-utils/fakeGoogleCast';
import type { GCastGlobals } from './googleCast';

const shell = vi.hoisted(() => ({ kind: 'web' as 'web' | 'capacitor' | 'tauri' }));
vi.mock('@/lib/playback/detectShell', () => ({ detectShell: () => shell.kind }));
vi.mock('@/lib/logger/client', () => ({ logger: { error: vi.fn(), breadcrumb: vi.fn(), warn: vi.fn() } }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));
const sdk = vi.hoisted(() => ({ globals: null as unknown, loads: 0 }));
vi.mock('./googleCast', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./googleCast')>();
  return {
    ...actual,
    castGlobals: () => sdk.globals,
    loadCastSdk: async () => {
      sdk.loads++;
      return !!sdk.globals;
    },
  };
});

const { initCast, requestCast, setCastMediaElement, _resetCast } = await import('./controller');
const { useCastStore } = await import('@/stores/useCastStore');
const { setCastSessionListener, _resetCastSession } = await import('./session');

const flush = () => new Promise((r) => setTimeout(r, 0));

function setWindow(over: Record<string, unknown>) {
  for (const [k, v] of Object.entries(over)) vi.stubGlobal(k, v);
}

beforeEach(() => {
  _resetCast();
  _resetCastSession();
  shell.kind = 'web';
  sdk.globals = null;
  sdk.loads = 0;
  toast.mockReset();
  toast.error.mockReset();
  useCastStore.setState({ path: null, availability: 'none', connection: 'idle', deviceName: null });
  window.localStorage.clear();
  setWindow({ isSecureContext: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as { Capacitor?: unknown }).Capacitor;
});

describe('cast controller: Chrome (Google Cast)', () => {
  it('shows the button before the SDK is loaded, and never loads it until the first tap', async () => {
    setWindow({ chrome: {} });
    initCast();
    await flush();
    expect(useCastStore.getState()).toMatchObject({ path: 'google', availability: 'unknown' });
    expect(sdk.loads).toBe(0);
  });

  it('hides the button when Chrome says no Cast device is around (Presentation API, no SDK)', async () => {
    const availability = { value: false, onchange: null as null | (() => void) };
    setWindow({ chrome: {}, PresentationRequest: class { getAvailability = async () => availability; } });
    initCast();
    await flush();
    expect(useCastStore.getState().availability).toBe('none');
    availability.value = true;
    availability.onchange?.();
    expect(useCastStore.getState().availability).toBe('available');
    expect(sdk.loads).toBe(0);
  });

  it('a tap loads the SDK, sets up the default receiver and opens the picker; a session reaches the player', async () => {
    setWindow({ chrome: {} });
    initCast();
    const fake = makeFakeCastGlobals();
    sdk.globals = fake.globals as GCastGlobals;
    const start = vi.fn();
    const end = vi.fn();
    setCastSessionListener({ start, end });
    await requestCast();
    expect(sdk.loads).toBe(1);
    expect(fake.ctx.setOptions).toHaveBeenCalledWith({ receiverApplicationId: 'CC1AD845', autoJoinPolicy: 'origin_scoped' });
    expect(fake.ctx.requestSession).toHaveBeenCalled();
    expect(window.localStorage.getItem('ember.cast.used')).toBe('1');

    fake.ctx.current = fake.session;
    fake.ctx.fire('sessionstatechanged', { sessionState: 'SESSION_STARTED' });
    fake.ctx.fire('caststatechanged', { castState: 'CONNECTED' });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ load: expect.any(Function) }), 'Living Room TV', { resumed: false });
    expect(useCastStore.getState()).toMatchObject({ connection: 'connected', deviceName: 'Living Room TV' });

    // Tapping again while casting stops it.
    await requestCast();
    expect(fake.ctx.endCurrentSession).toHaveBeenCalledWith(true);
    fake.ctx.current = null;
    fake.ctx.fire('sessionstatechanged', { sessionState: 'SESSION_ENDED' });
    fake.ctx.fire('caststatechanged', { castState: 'NOT_CONNECTED' });
    expect(end).toHaveBeenCalled();
    expect(useCastStore.getState()).toMatchObject({ connection: 'idle', deviceName: null, availability: 'available' });
  });

  it('a browser that has cast before loads the SDK at start, to rejoin a running session', async () => {
    setWindow({ chrome: {} });
    window.localStorage.setItem('ember.cast.used', '1');
    const fake = makeFakeCastGlobals();
    fake.ctx.current = fake.session;
    fake.ctx.castState = 'CONNECTED';
    sdk.globals = fake.globals as GCastGlobals;
    const start = vi.fn();
    setCastSessionListener({ start, end: vi.fn() });
    initCast();
    await flush();
    expect(sdk.loads).toBe(1);
    expect(start).toHaveBeenCalledWith(expect.anything(), 'Living Room TV', { resumed: true });
  });

  it('an SDK that will not load says so', async () => {
    setWindow({ chrome: {} });
    initCast();
    await requestCast();
    expect(toast.error).toHaveBeenCalled();
  });

  it('closing the picker is not an error', async () => {
    setWindow({ chrome: {} });
    initCast();
    const fake = makeFakeCastGlobals();
    fake.ctx.requestSession.mockRejectedValueOnce('cancel');
    sdk.globals = fake.globals as GCastGlobals;
    await requestCast();
    expect(toast.error).not.toHaveBeenCalled();
  });
});

describe('cast controller: Safari (AirPlay)', () => {
  it('follows the audio element\'s AirPlay availability and state, and prompts on a tap', async () => {
    setWindow({ WebKitPlaybackTargetAvailabilityEvent: class {} });
    const listeners: Record<string, () => void> = {};
    let watch: (a: boolean) => void = () => {};
    const remote = {
      state: 'disconnected',
      watchAvailability: vi.fn(async (cb: (a: boolean) => void) => { watch = cb; return 1; }),
      cancelWatchAvailability: vi.fn(async () => {}),
      prompt: vi.fn(async () => {}),
      addEventListener: (t: string, cb: () => void) => { listeners[t] = cb; },
      removeEventListener: vi.fn(),
    };
    const el = { remote } as unknown as HTMLMediaElement;
    setCastMediaElement(el);
    initCast();
    await flush();
    expect(useCastStore.getState().path).toBe('airplay');
    watch(true);
    expect(useCastStore.getState().availability).toBe('available');
    remote.state = 'connected';
    listeners.connect();
    expect(useCastStore.getState().connection).toBe('connected');
    await requestCast();
    expect(remote.prompt).toHaveBeenCalled();
    setCastMediaElement(null);
    expect(remote.cancelWatchAvailability).toHaveBeenCalledWith(1);
  });
});

describe('cast controller: other shells', () => {
  it('the desktop app has no cast button', () => {
    shell.kind = 'tauri';
    setWindow({ chrome: {} });
    initCast();
    expect(useCastStore.getState().path).toBeNull();
  });

  it('the Android app follows the native Cast state and opens the native picker', async () => {
    shell.kind = 'capacitor';
    let emit: (s: unknown) => void = () => {};
    const plugin = {
      getCastState: vi.fn(async () => ({ available: true, connected: false })),
      showCastPicker: vi.fn(async () => {}),
      addListener: vi.fn((_e: string, cb: (s: unknown) => void) => { emit = cb; return Promise.resolve(); }),
    };
    (window as unknown as { Capacitor: unknown }).Capacitor = { Plugins: { EmberPlayer: plugin } };
    initCast();
    await flush();
    expect(useCastStore.getState()).toMatchObject({ path: 'android', availability: 'available', connection: 'idle' });
    emit({ available: true, connected: true, deviceName: 'Kitchen speaker' });
    expect(useCastStore.getState()).toMatchObject({ connection: 'connected', deviceName: 'Kitchen speaker' });
    emit({ available: false, connected: false });
    expect(useCastStore.getState()).toMatchObject({ availability: 'none', connection: 'idle' });
    await requestCast();
    expect(plugin.showCastPicker).toHaveBeenCalled();
  });

  it('an Android app build from before casting has no button', () => {
    shell.kind = 'capacitor';
    (window as unknown as { Capacitor: unknown }).Capacitor = { Plugins: { EmberPlayer: { setQueue: vi.fn() } } };
    initCast();
    expect(useCastStore.getState().path).toBeNull();
  });
});
