/** A playlist downloaded to browser storage, player side (bughunt P09).
 *
 *  The download gives each saved track a local blob: URL (lib/offline.ts,
 *  `webFiles` in the offline store). The player must play that copy instead
 *  of the network stream. The desktop app's Rust engine fetches outside the
 *  webview and cannot read a blob: URL, so there it keeps streaming while
 *  online, and swaps to web audio only when offline, where the local copy is
 *  the one thing that can still play. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlayerProvider, usePlayer } from './PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useOfflineStore } from '@/stores/useOfflineStore';
import { makeFakeBackend, makeTrack } from '@/test-utils/fakeBackend';

vi.mock('@/lib/api', () => ({ api: {}, apiUrl: (u: string) => u }));
vi.mock('@/lib/logger/client', () => ({
  logger: { boot: vi.fn(), setContext: vi.fn(), breadcrumb: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const shell = vi.hoisted(() => ({ kind: 'web' as 'web' | 'tauri' }));
vi.mock('@/lib/playback/detectShell', () => ({ detectShell: () => shell.kind }));
vi.mock('@/lib/playback/nativeBridge', () => ({ createNativeBackend: vi.fn(), nativeBackendReady: () => true }));

const nativeEngine = makeFakeBackend();
const createTauriBackend = vi.hoisted(() => vi.fn());
vi.mock('@/lib/playback/tauriBackend', () => ({ createTauriBackend }));
const webEngine = makeFakeBackend();
const createWebBackend = vi.hoisted(() => vi.fn());
vi.mock('@/lib/playback/webBackend', () => ({ createWebBackend }));

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

const TRACK = makeTrack({ id: 'upload:u1', source: 'upload', streamUrl: '/api/uploads/u1/stream' });
const BLOB = 'blob:http://app/abc';

function Harness() {
  const { playTrack } = usePlayer();
  return <button onClick={() => playTrack(TRACK)}>play</button>;
}

function setOnline(on: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
}

function mountAndPlay() {
  render(<PlayerProvider><Harness /></PlayerProvider>);
  nativeEngine.load.mockClear();
  webEngine.load.mockClear();
  fireEvent.click(screen.getByText('play'));
}

beforeEach(() => {
  vi.clearAllMocks();
  shell.kind = 'web';
  setOnline(true);
  createTauriBackend.mockImplementation(() => nativeEngine);
  createWebBackend.mockImplementation(() => webEngine);
  usePlayerStore.setState({ queue: [TRACK], index: 0, position: 0, isPlaying: false, duration: 0, context: null });
  useOfflineStore.setState({ trackFiles: {}, webFiles: { [TRACK.id]: BLOB } });
});

describe('a browser-storage download', () => {
  it('plays the downloaded copy in a browser', () => {
    setOnline(false);
    mountAndPlay();

    expect(webEngine.load).toHaveBeenLastCalledWith(BLOB, expect.objectContaining({ autoplay: true }));
  });

  it('plays the downloaded copy online too (no data used)', () => {
    mountAndPlay();

    expect(webEngine.load).toHaveBeenLastCalledWith(BLOB, expect.anything());
  });

  it('streams a track that has no downloaded copy', () => {
    useOfflineStore.setState({ webFiles: {} });
    mountAndPlay();

    expect(webEngine.load).toHaveBeenLastCalledWith('/api/uploads/u1/stream', expect.anything());
  });

  it('never hands a blob: URL to the desktop Rust engine', () => {
    shell.kind = 'tauri';
    mountAndPlay();

    expect(nativeEngine.load).toHaveBeenLastCalledWith('/api/uploads/u1/stream', expect.anything());
    expect(createWebBackend).not.toHaveBeenCalled();
  });

  it('swaps the desktop app to web audio offline, and plays the downloaded copy there', () => {
    shell.kind = 'tauri';
    setOnline(false);
    mountAndPlay();

    expect(createWebBackend).toHaveBeenCalledTimes(1);
    expect(nativeEngine.load).not.toHaveBeenCalled();
    expect(webEngine.load).toHaveBeenLastCalledWith(BLOB, expect.objectContaining({ autoplay: true }));
  });
});
