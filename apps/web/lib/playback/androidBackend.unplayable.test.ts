import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAndroidBackend, parseNotice } from './androidBackend';
import { makeFakeEvents } from '@/test-utils/fakeBackend';

// Songs the native player could not play, as the web side hears of them: the
// `unplayable` event (live), the ones native held while no page listened
// (drainUnplayable, at start), and the bare `error` of an app build that
// explains nothing (which now names the song native was on).

vi.mock('@/lib/logger/client', () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));

type Listener = (d: unknown) => void;

function installPlugin({ explains, held = [] as unknown[] }: { explains: boolean; held?: unknown[] }) {
  const listeners = new Map<string, Listener>();
  const plugin: Record<string, unknown> = {
    addListener: vi.fn((event: string, cb: Listener) => { listeners.set(event, cb); return Promise.resolve({ remove: () => {} }); }),
    setQueue: vi.fn().mockResolvedValue(undefined),
    getState: vi.fn(() => new Promise(() => {})),
  };
  if (explains) plugin.drainUnplayable = vi.fn().mockResolvedValue({ notices: held });
  (window as unknown as { Capacitor: unknown }).Capacitor = { Plugins: { EmberPlayer: plugin } };
  return { plugin, emit: (event: string, d: unknown) => listeners.get(event)?.(d), hasListener: (e: string) => listeners.has(e) };
}

const notice = { trackId: 'youtube:0LYiIUMeO1o', title: 'Radio Song', kind: 'unavailable', reason: 'unavailable', outcome: 'skipped' };

afterEach(() => { delete (window as unknown as { Capacitor?: unknown }).Capacitor; });

describe('androidBackend: songs native could not play', () => {
  it('passes the live event on, checked', () => {
    const n = installPlugin({ explains: true });
    const events = makeFakeEvents();
    events.onUnplayable = vi.fn();
    createAndroidBackend(events);
    n.emit('unplayable', { notices: [notice, { trackId: '', outcome: 'skipped' }, { trackId: 'x', outcome: 'weird' }] });
    expect(events.onUnplayable).toHaveBeenCalledWith([
      { trackId: 'youtube:0LYiIUMeO1o', title: 'Radio Song', kind: 'unavailable', reason: 'unavailable', outcome: 'skipped' },
    ]);
  });

  it('picks up the ones held while no page was listening', async () => {
    installPlugin({ explains: true, held: [notice, { ...notice, trackId: 'youtube:b', outcome: 'gave-up' }] });
    const events = makeFakeEvents();
    events.onUnplayable = vi.fn();
    createAndroidBackend(events);
    await vi.waitFor(() => expect(events.onUnplayable).toHaveBeenCalledTimes(1));
    expect((events.onUnplayable as ReturnType<typeof vi.fn>).mock.calls[0][0]).toHaveLength(2);
  });

  it('a bare error says which song native was on, and whether native explains it', () => {
    const n = installPlugin({ explains: false });
    const events = makeFakeEvents();
    createAndroidBackend(events);
    n.emit('state', { playing: true, position: 3, duration: 200, index: 1, trackId: 'youtube:b' });
    n.emit('error', { message: 'Source error' });
    expect(events.onError).toHaveBeenCalledWith({ trackId: 'youtube:b', nativeExplains: false });
    expect(n.hasListener('unplayable')).toBe(false);
  });

  it('an app build that explains says so on its errors', () => {
    const n = installPlugin({ explains: true });
    const events = makeFakeEvents();
    createAndroidBackend(events);
    n.emit('error', { message: 'Source error' });
    expect(events.onError).toHaveBeenCalledWith({ trackId: null, nativeExplains: true });
  });
});

describe('parseNotice', () => {
  it('keeps a good one and defaults the loose fields', () => {
    expect(parseNotice({ trackId: 't', outcome: 'stopped' })).toEqual({ trackId: 't', title: '', kind: 'transient', reason: null, outcome: 'stopped' });
  });
  it('drops junk', () => {
    expect(parseNotice(null)).toBeNull();
    expect(parseNotice({ trackId: 5, outcome: 'skipped' })).toBeNull();
    expect(parseNotice({ trackId: 't' })).toBeNull();
  });
});
