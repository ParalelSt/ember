import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { PlayerProvider } from './PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { makeFakeBackend } from '@/test-utils/fakeBackend';

// A ducking prank sound turns the music down through the provider's one
// volume effect, on whatever engine is live, and hands it back after.

vi.mock('@/lib/api', () => ({ api: {}, apiUrl: (u: string) => u }));
const fake = makeFakeBackend();
vi.mock('@/lib/playback/webBackend', () => ({ createWebBackend: () => fake }));
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

const receiver = vi.hoisted(() => ({ onDuck: null as null | ((level: number) => void) }));
vi.mock('./PrankReceiver', () => ({
  PrankReceiver: (p: { onDuck: (level: number) => void }) => {
    receiver.onDuck = p.onDuck;
    return null;
  },
}));

const lastVolume = () => fake.setVolume.mock.calls.at(-1);

beforeEach(() => {
  vi.clearAllMocks();
  receiver.onDuck = null;
  useSettingsStore.setState({ partyVolume: false });
  usePlayerStore.setState({ queue: [], index: -1, position: 0, isPlaying: false, duration: 0, volume: 0.8, muted: false });
});

describe('PlayerProvider: ducking', () => {
  it('scales the music to 30% of the slider while ducked and restores it after', () => {
    render(<PlayerProvider>{null}</PlayerProvider>);
    expect(lastVolume()).toEqual([0.8, { gain: 1, normGain: 1 }]);

    act(() => receiver.onDuck!(0.3));
    expect(lastVolume()![0]).toBeCloseTo(0.24);
    expect(lastVolume()![1]).toEqual({ gain: 1, normGain: 1 });

    act(() => receiver.onDuck!(1));
    expect(lastVolume()).toEqual([0.8, { gain: 1, normGain: 1 }]);
  });

  it('a slider move while ducked stays ducked; mute still wins', () => {
    render(<PlayerProvider>{null}</PlayerProvider>);
    act(() => receiver.onDuck!(0.3));
    act(() => usePlayerStore.setState({ volume: 0.5 }));
    expect(lastVolume()![0]).toBeCloseTo(0.15);
    act(() => usePlayerStore.setState({ muted: true }));
    expect(lastVolume()![0]).toBe(0);
    act(() => receiver.onDuck!(1));
    act(() => usePlayerStore.setState({ muted: false }));
    expect(lastVolume()).toEqual([0.5, { gain: 1, normGain: 1 }]);
  });

  it('keeps the party gain while ducked', () => {
    useSettingsStore.setState({ partyVolume: true });
    usePlayerStore.setState({ volume: 1 });
    render(<PlayerProvider>{null}</PlayerProvider>);
    act(() => receiver.onDuck!(0.3));
    expect(lastVolume()![0]).toBeCloseTo(0.3);
    expect(lastVolume()![1]).toEqual({ gain: 2, normGain: 1 });
  });
});
