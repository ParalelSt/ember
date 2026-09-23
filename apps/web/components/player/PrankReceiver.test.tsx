import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { createRef, type RefObject } from 'react';
import { PrankReceiver } from './PrankReceiver';
import { makeFakeBackend, makeTrack, type FakeBackend } from '@/test-utils/fakeBackend';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import type { OverlayHandle, OverlayPlayer, OverlayResult } from '@/lib/pranks/overlayPlayer';
import type { PrankAck, PrankEngine, PrankRow } from '@/lib/pranks/types';
import type { PrankReceipt } from '@/hooks/pranks/usePrankInbox';
import type { AudioBackend } from '@/lib/playback/types';

// The receiver's sound path: what it decides, what it plays, how it ducks the
// music and what it reports, with the inbox and the overlay replaced by
// doubles. Nothing on this side may toast or log.

const inbox = vi.hoisted(() => ({
  receive: null as null | ((row: PrankRow) => PrankAck | PrankReceipt | null | Promise<PrankAck | PrankReceipt | null>),
}));
vi.mock('@/hooks/pranks/usePrankInbox', () => ({
  usePrankInbox: (opts: { receive: typeof inbox.receive }) => {
    inbox.receive = opts.receive;
  },
}));
vi.mock('@/hooks/pranks/usePresenceHeartbeat', () => ({ usePresenceHeartbeat: () => {} }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/lib/api', () => ({ apiUrl: (u: string) => `https://host${u}` }));
const noise = vi.hoisted(() => ({ toast: vi.fn(), log: vi.fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(noise.toast, { success: noise.toast, error: noise.toast }) }));
vi.mock('@/lib/logger/client', () => ({
  logger: { error: noise.log, info: noise.log, warn: noise.log, breadcrumb: noise.log, setContext: noise.log },
}));

/** An overlay double: each play() returns a handle the test settles. */
function fakeOverlay() {
  let startResolve: (v: boolean) => void = () => {};
  let finishResolve: (r: OverlayResult) => void = () => {};
  let busy = false;
  const o = {
    play: vi.fn<(url: string, opts: { volume: number; maxSec: number }) => OverlayHandle>(() => {
      busy = true;
      const started = new Promise<boolean>((r) => (startResolve = r));
      const finished = new Promise<OverlayResult>((r) => (finishResolve = (x) => { busy = false; r(x); }));
      return { started, finished };
    }),
    setVolume: vi.fn(),
    stop: vi.fn(() => finishResolve({ reason: 'stopped', playedSec: 1 })),
    busy: () => busy,
    destroy: vi.fn(),
    start: (ok = true) => startResolve(ok),
    finish: (r: OverlayResult) => finishResolve(r),
  };
  return o as typeof o & OverlayPlayer;
}

const sound = (over: Partial<PrankRow['params']> = {}): PrankRow => ({
  id: 'p1', kind: 'sound', streamUrl: '/api/pranks/media/s1', expiresAt: '2099-01-01 00:00:00.000Z',
  params: { durationSec: 30, volume: 0.5, mode: 'duck', startFrom: 'start', ...over },
});

let backend: FakeBackend;
let overlay: ReturnType<typeof fakeOverlay>;
let onDuck: ReturnType<typeof vi.fn<(level: number) => void>>;

function mount(engine: PrankEngine = 'web') {
  const backendRef = createRef<AudioBackend | null>() as RefObject<AudioBackend | null>;
  backendRef.current = backend;
  const engineRef = { current: engine } as RefObject<PrankEngine>;
  return render(<PrankReceiver backendRef={backendRef} engineRef={engineRef} onDuck={onDuck} makeOverlay={() => overlay} />);
}
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

beforeEach(() => {
  inbox.receive = null;
  noise.toast.mockReset();
  noise.log.mockReset();
  backend = makeFakeBackend({ paused: false });
  overlay = fakeOverlay();
  onDuck = vi.fn();
  useSettingsStore.setState({ partyVolume: false });
  usePlayerStore.setState({ queue: [makeTrack({ id: 'youtube:a' })], index: 0, isPlaying: true, volume: 0.64, muted: false });
});

describe('PrankReceiver: sounds', () => {
  it('plays the sound at a share of their volume, ducks once it is heard, reports delivered then done', async () => {
    mount();
    const pending = inbox.receive!(sound());
    expect(overlay.play).toHaveBeenCalledWith('https://host/api/pranks/media/s1', { volume: expect.any(Number), maxSec: 30 });
    // 0.5 of what the music element plays at (0.64 ** 1.5).
    expect(overlay.play.mock.calls[0][1].volume).toBeCloseTo(0.256);
    await flush();
    expect(onDuck).not.toHaveBeenCalled();

    overlay.start();
    const receipt = (await pending) as PrankReceipt;
    expect(receipt.ack).toEqual({ status: 'delivered', engine: 'web', appVersion: expect.any(String) });
    expect(onDuck).toHaveBeenLastCalledWith(0.3);

    overlay.finish({ reason: 'ended', playedSec: 2.5 });
    expect(await receipt.then).toEqual({ status: 'done', playedSec: 2.5 });
    expect(onDuck).toHaveBeenLastCalledWith(1);
    expect(noise.toast).not.toHaveBeenCalled();
    expect(noise.log).not.toHaveBeenCalled();
  });

  it('over mode leaves the music alone', async () => {
    mount();
    const pending = inbox.receive!(sound({ mode: 'over' }));
    overlay.start();
    const receipt = (await pending) as PrankReceipt;
    overlay.finish({ reason: 'ended', playedSec: 1 });
    await receipt.then;
    expect(onDuck).not.toHaveBeenCalledWith(0.3);
  });

  it('plays on the older Android app and the desktop webview too', async () => {
    for (const engine of ['capacitor', 'tauri-native'] as const) {
      overlay = fakeOverlay();
      const { unmount } = mount(engine);
      const pending = inbox.receive!(sound());
      overlay.start();
      expect(((await pending) as PrankReceipt).ack).toMatchObject({ status: 'delivered', engine });
      unmount();
    }
  });

  it('skips on the native Android engine until it has its own overlay', async () => {
    mount('android');
    expect(inbox.receive!(sound())).toMatchObject({ status: 'skipped', reason: 'engine-unsupported', engine: 'android' });
    expect(overlay.play).not.toHaveBeenCalled();
  });

  it('only while music is actually playing', async () => {
    usePlayerStore.setState({ isPlaying: false });
    mount();
    expect(inbox.receive!(sound())).toMatchObject({ status: 'skipped', reason: 'not-playing' });
    usePlayerStore.setState({ isPlaying: true });
    backend.paused = true;
    expect(inbox.receive!({ ...sound(), id: 'p2' })).toMatchObject({ status: 'skipped', reason: 'not-playing' });
    expect(overlay.play).not.toHaveBeenCalled();
  });

  it('one sound at a time', async () => {
    mount();
    void inbox.receive!(sound());
    expect(inbox.receive!({ ...sound(), id: 'p2' })).toMatchObject({ status: 'skipped', reason: 'busy' });
  });

  it('a sound that will not load is skipped, and nothing is ducked', async () => {
    mount();
    const pending = inbox.receive!(sound());
    overlay.start(false);
    overlay.finish({ reason: 'error', playedSec: 0 });
    expect(await pending).toMatchObject({ status: 'skipped', reason: 'error:load' });
    expect(onDuck).not.toHaveBeenCalledWith(0.3);
  });

  it('pausing the music ends the sound and lifts the duck', async () => {
    mount();
    const pending = inbox.receive!(sound());
    overlay.start();
    const receipt = (await pending) as PrankReceipt;
    act(() => usePlayerStore.setState({ isPlaying: false }));
    expect(overlay.stop).toHaveBeenCalled();
    expect(await receipt.then).toEqual({ status: 'done', playedSec: 1 });
    expect(onDuck).toHaveBeenLastCalledWith(1);
  });

  it('follows their volume and mute while it plays', async () => {
    mount();
    const pending = inbox.receive!(sound({ volume: 1 }));
    overlay.start();
    await pending;
    act(() => usePlayerStore.setState({ volume: 0.25 }));
    expect(overlay.setVolume).toHaveBeenLastCalledWith(0.125);
    act(() => usePlayerStore.setState({ muted: true }));
    expect(overlay.setVolume).toHaveBeenLastCalledWith(0);
  });

  it('pings are still just acknowledged, swaps still unsupported', () => {
    mount();
    const ping: PrankRow = { ...sound(), id: 'p3', kind: 'ping', streamUrl: null };
    expect(inbox.receive!(ping)).toMatchObject({ status: 'delivered' });
    const swap: PrankRow = { ...sound(), id: 'p4', kind: 'swap' };
    expect(inbox.receive!(swap)).toMatchObject({ status: 'skipped', reason: 'engine-unsupported' });
  });

  it('a late sound is ignored without a word', () => {
    mount();
    expect(inbox.receive!({ ...sound(), expiresAt: '2001-01-01 00:00:00.000Z' })).toBeNull();
    expect(overlay.play).not.toHaveBeenCalled();
  });

  it('tears the overlay down on unmount', () => {
    const { unmount } = mount();
    void inbox.receive!(sound());
    unmount();
    expect(overlay.destroy).toHaveBeenCalled();
  });
});
