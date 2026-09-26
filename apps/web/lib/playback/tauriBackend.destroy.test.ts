/** A desktop engine destroyed before its event subscriptions came back
 *  (bughunt 2026-09-25 P8). listen() is asynchronous; destroy() only removed
 *  the subscriptions that had already resolved, so a late one stayed wired
 *  for good and kept feeding the provider from a dead backend. React's dev
 *  double mount does exactly this, and then every engine event arrived twice:
 *  one "ended" skipped two songs. */
import { describe, expect, it, vi } from 'vitest';
import { createTauriBackend } from './tauriBackend';
import { makeFakeEvents } from '@/test-utils/fakeBackend';

type Listener = (e: { payload: unknown }) => void;
const live = new Map<string, Set<Listener>>();
const pending: Array<() => void> = [];

vi.mock('@tauri-apps/api/core', () => ({ invoke: () => Promise.resolve() }));
vi.mock('@tauri-apps/api/event', () => ({
  // Registers at once (as Tauri does), but hands back the unlisten function
  // only when the test says the IPC answer came back.
  listen: (name: string, fn: Listener) => {
    const set = live.get(name) ?? new Set<Listener>();
    live.set(name, set);
    set.add(fn);
    return new Promise((resolve) => pending.push(() => resolve(() => set.delete(fn))));
  },
}));

const emit = (name: string, payload: unknown = {}) => live.get(name)?.forEach((fn) => fn({ payload }));

describe('tauriBackend destroy before listen() resolved', () => {
  it('unsubscribes the late listeners and reports nothing after destroy', async () => {
    const events = makeFakeEvents();
    const b = createTauriBackend(events);
    b.destroy();
    pending.splice(0).forEach((resolve) => resolve());
    await Promise.resolve();
    await Promise.resolve();
    emit('audio:ended');
    emit('audio:time', { sec: 12 });
    expect(events.onEnded).not.toHaveBeenCalled();
    expect(events.onTime).not.toHaveBeenCalled();
    expect([...live.values()].every((s) => s.size === 0)).toBe(true);
  });
});
