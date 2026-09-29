import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { PlayerProvider } from './PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { makeFakeBackend } from '@/test-utils/fakeBackend';

// Party mode (gain > 1) is desktop-only: a mouse-driven web browser or Tauri,
// never a touch device or the Android app. This is the "must behave exactly
// as if party mode were off" half of that: a phone, tablet or Capacitor build
// gets gain: 1 from the engine even when the account's partyVolume is on
// (saved from another, eligible device), and a stored volume above the
// normal-mode range is untouched (no snap).

vi.mock('@/lib/api', () => ({ api: {}, apiUrl: (u: string) => u }));
const shell = vi.hoisted(() => ({ kind: 'web' as 'web' | 'capacitor' | 'tauri' }));
vi.mock('@/lib/playback/detectShell', () => ({ detectShell: () => shell.kind }));
const fake = makeFakeBackend();
vi.mock('@/lib/playback/webBackend', () => ({ createWebBackend: () => fake }));
vi.mock('@/lib/playback/capacitorBackend', () => ({ createCapacitorBackend: () => fake }));
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
vi.mock('./PrankReceiver', () => ({ PrankReceiver: () => null }));

const lastVolume = () => fake.setVolume.mock.calls.at(-1);

const coarsePointer = (on: boolean) =>
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: on && q === '(pointer: coarse)' }) as MediaQueryList);

beforeEach(() => {
  vi.clearAllMocks();
  shell.kind = 'web';
  coarsePointer(false);
  useSettingsStore.setState({ partyVolume: true });
  usePlayerStore.setState({ queue: [], index: -1, position: 0, isPlaying: false, duration: 0, volume: 0.8, muted: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PlayerProvider: party mode is desktop-only', () => {
  it('applies gain: 2 on a mouse-driven web browser', () => {
    render(<PlayerProvider>{null}</PlayerProvider>);
    expect(lastVolume()).toEqual([0.8, { gain: 2, normGain: 1 }]);
  });

  it('forces gain: 1 on a touch (coarse-pointer) browser even though partyVolume is on', () => {
    coarsePointer(true);
    render(<PlayerProvider>{null}</PlayerProvider>);
    expect(lastVolume()).toEqual([0.8, { gain: 1, normGain: 1 }]);
  });

  it('forces gain: 1 on the Android app (Capacitor) even though partyVolume is on', () => {
    shell.kind = 'capacitor';
    render(<PlayerProvider>{null}</PlayerProvider>);
    expect(lastVolume()).toEqual([0.8, { gain: 1, normGain: 1 }]);
  });

  it('applies gain: 2 on the Tauri desktop app regardless of pointer', () => {
    shell.kind = 'tauri';
    coarsePointer(true);
    render(<PlayerProvider>{null}</PlayerProvider>);
    expect(lastVolume()).toEqual([0.8, { gain: 2, normGain: 1 }]);
  });

  it('leaves a stored 0.97 alone on a device that is not party-eligible (top of the slider is full output)', () => {
    coarsePointer(true);
    usePlayerStore.setState({ volume: 1 });
    render(<PlayerProvider>{null}</PlayerProvider>);
    expect(usePlayerStore.getState().volume).toBe(1);
    expect(lastVolume()).toEqual([1, { gain: 1, normGain: 1 }]);
  });

  it('leaves a stored volume alone on an eligible device', () => {
    usePlayerStore.setState({ volume: 0.97 });
    render(<PlayerProvider>{null}</PlayerProvider>);
    expect(usePlayerStore.getState().volume).toBe(0.97);
  });
});
