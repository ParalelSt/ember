/** The provider driving the native Android player, which owns the queue and
 *  the loop mode. What is checked is what crosses the bridge: every setQueue
 *  and setLoop the provider sends, and what it mirrors from native.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { PlayerProvider } from './PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { makeFakeBackend, makeTrack } from '@/test-utils/fakeBackend';
import type { AudioBackendEvents } from '@/lib/playback/types';

vi.mock('@/lib/api', () => ({ api: {}, apiUrl: (u: string) => u }));
vi.mock('@/lib/playback/detectShell', () => ({ detectShell: () => 'capacitor' }));

const fake = makeFakeBackend();
const native = vi.hoisted(() => ({ setQueue: vi.fn(), setLoop: vi.fn(), next: vi.fn(), prev: vi.fn() }));
let ev: AudioBackendEvents | null = null;
vi.mock('@/lib/playback/androidBackend', () => ({
  androidPluginPresent: () => true,
  createAndroidBackend: (events: AudioBackendEvents) => {
    ev = events;
    return Object.assign(fake, native);
  },
}));

vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/hooks/useLibrary', () => ({
  useQueryHistory: () => ({ data: [] }),
  useQueryLikes: () => ({ data: [] }),
  useExecuteRecordPlay: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/hooks/useLyrics', () => ({ useQueryLyrics: () => ({ data: undefined }) }));
vi.mock('@/hooks/player/useAvailabilityProbe', () => ({ useAvailabilityProbe: () => vi.fn() }));
vi.mock('@/hooks/player/useDiscordPresence', () => ({ useDiscordPresence: vi.fn() }));
vi.mock('@/hooks/player/useRadioExtend', () => ({ useRadioExtend: vi.fn() }));
vi.mock('@/hooks/player/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: vi.fn() }));
vi.mock('@/hooks/player/useRemoteCommands', () => ({ useRemoteCommands: vi.fn() }));

const A = makeTrack({ id: 'youtube:a', sourceId: 'a', streamUrl: '/s/a', durationSec: 200 });
const B = makeTrack({ id: 'youtube:b', sourceId: 'b', streamUrl: '/s/b', durationSec: 200 });

beforeEach(() => {
  vi.clearAllMocks();
  ev = null;
  usePlayerStore.setState({
    queue: [A, B], index: 0, position: 0, isPlaying: false, duration: 0,
    context: null, loopMode: 'off', shuffle: false, orderBackup: null,
  });
});

describe('android: the loop button', () => {
  it('tells the native player the loop mode at startup', () => {
    usePlayerStore.setState({ loopMode: 'all' });
    render(<PlayerProvider><div /></PlayerProvider>);
    expect(native.setLoop).toHaveBeenLastCalledWith('all');
  });

  it('every press of the loop button reaches the native player', () => {
    render(<PlayerProvider><div /></PlayerProvider>);
    native.setLoop.mockClear();
    act(() => { usePlayerStore.getState().cycleLoopMode(); });
    act(() => { usePlayerStore.getState().cycleLoopMode(); });
    act(() => { usePlayerStore.getState().cycleLoopMode(); });
    expect(native.setLoop.mock.calls).toEqual([['all'], ['one'], ['off']]);
  });

  it('a Repeat press in the car or notification shows on the loop button', () => {
    render(<PlayerProvider><div /></PlayerProvider>);
    act(() => { ev!.onLoopMode!('one'); });
    expect(usePlayerStore.getState().loopMode).toBe('one');
  });
});
