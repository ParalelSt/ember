import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { PlayerProvider } from './PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { makeFakeBackend, makeTrack } from '@/test-utils/fakeBackend';
import type { AudioBackendEvents } from '@/lib/playback/types';
import type { EqSettings } from '@/lib/playback/eq';

// The equalizer end to end in the provider: the engine gets the setting at
// startup and on every change, and a desktop engine that falls back to web
// audio hands the setting on to it.

vi.mock('@/lib/api', () => ({ api: {}, apiUrl: (u: string) => u }));
const shell = vi.hoisted(() => ({ kind: 'web' as 'web' | 'tauri' }));
vi.mock('@/lib/playback/detectShell', () => ({ detectShell: () => shell.kind }));
vi.mock('@/lib/playback/nativeBridge', () => ({ nativeBackendReady: () => true, createNativeBackend: vi.fn() }));
const web = makeFakeBackend({ setEq: vi.fn() });
const desktop = makeFakeBackend({ setEq: vi.fn() });
let desktopEvents: AudioBackendEvents | null = null;
vi.mock('@/lib/playback/webBackend', () => ({ createWebBackend: () => web }));
vi.mock('@/lib/playback/tauriBackend', () => ({
  createTauriBackend: (ev: AudioBackendEvents) => {
    desktopEvents = ev;
    return desktop;
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
vi.mock('./PrankReceiver', () => ({ PrankReceiver: () => null }));

const A = makeTrack({ id: 'youtube:a', sourceId: 'a', streamUrl: '/s/a', durationSec: 200 });
const OFF: EqSettings = { enabled: false, bands: [0, 0, 0, 0, 0] };
const BASS: EqSettings = { enabled: true, bands: [7, 4, 0, 0, 0] };

beforeEach(() => {
  vi.clearAllMocks();
  shell.kind = 'web';
  desktopEvents = null;
  useSettingsStore.setState({ equalizer: OFF, pluginsUserId: null });
  usePlayerStore.setState({ queue: [A], index: 0, position: 0, isPlaying: false, duration: 0, volume: 0.8, muted: false });
});

describe('PlayerProvider: equalizer', () => {
  it('hands the engine the setting at startup and on every change', () => {
    render(<PlayerProvider>{null}</PlayerProvider>);
    expect(web.setEq).toHaveBeenLastCalledWith(OFF);
    act(() => useSettingsStore.getState().setEqualizer(BASS));
    expect(web.setEq).toHaveBeenLastCalledWith(BASS);
    act(() => useSettingsStore.getState().setEqualizer({ ...BASS, enabled: false }));
    expect(web.setEq).toHaveBeenLastCalledWith({ ...BASS, enabled: false });
  });

  it('the desktop engine gets it, and so does web audio when the engine falls back to it', () => {
    shell.kind = 'tauri';
    useSettingsStore.setState({ equalizer: BASS });
    render(<PlayerProvider>{null}</PlayerProvider>);
    expect(desktop.setEq).toHaveBeenLastCalledWith(BASS);
    expect(web.setEq).not.toHaveBeenCalled();
    act(() => desktopEvents!.onError({ canRetryOnWebAudio: true }));
    expect(web.setEq).toHaveBeenLastCalledWith(BASS);
  });
});
