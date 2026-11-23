/** The playhead's reports (several a second while audio plays) re-render
 *  only the views that show the position, not every usePlayer reader: each
 *  track list page reads usePlayer (useTrackActions), and a Liked list of
 *  thousands of rows was rebuilt on every report. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { PlayerProvider, usePlayer, usePlayerPosition } from './PlayerProvider';
import { PlayheadFrozenContext } from './playheadFrozen';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { makeFakeBackend, makeTrack } from '@/test-utils/fakeBackend';
import type { AudioBackendEvents } from '@/lib/playback/types';

vi.mock('@/lib/api', () => ({ api: { updateDiscord: vi.fn(() => Promise.resolve({ ok: true })) }, apiUrl: (u: string) => u }));
vi.mock('@/lib/logger/client', () => ({
  logger: { boot: vi.fn(), setContext: vi.fn(), breadcrumb: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const fake = makeFakeBackend();
let events: AudioBackendEvents | null = null;
vi.mock('@/lib/playback/webBackend', () => ({
  createWebBackend: (e: AudioBackendEvents) => {
    events = e;
    return fake;
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
vi.mock('@/hooks/player/useRadioExtend', () => ({ useRadioExtend: vi.fn() }));
vi.mock('@/hooks/player/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: vi.fn() }));
vi.mock('@/hooks/player/useRemoteCommands', () => ({ useRemoteCommands: vi.fn() }));
// The provider's own renders, counted through a child it re-renders each time.
const providerRendered = vi.hoisted(() => vi.fn());
vi.mock('./PrankReceiver', () => ({ PrankReceiver: () => { providerRendered(); return null; } }));
const presence = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/player/useDiscordPresence', () => ({ useDiscordPresence: presence }));

const SONG = makeTrack({ id: 'youtube:song', title: 'Song', durationSec: 200 });

const listRendered = vi.fn();
const clockRendered = vi.fn();

/** A page that plays songs but never shows the playhead (a track list). */
function ListPage() {
  const { current, isPlaying, playTrack } = usePlayer();
  listRendered();
  return <button onClick={() => playTrack(SONG)}>{current?.title}{isPlaying ? ' playing' : ''}</button>;
}

/** The seek bar's reader. */
function Clock() {
  clockRendered(usePlayerPosition());
  return null;
}

beforeEach(() => {
  events = null;
  presence.mockClear();
  providerRendered.mockClear();
  listRendered.mockClear();
  clockRendered.mockClear();
  fake.currentTime = 0;
  fake.durationSec = 200;
  fake.paused = false;
  usePlayerStore.setState({ queue: [SONG], index: 0, position: 0, duration: 200, isPlaying: true, context: null });
});

describe('playhead reports', () => {
  it('do not re-render a usePlayer reader that does not show the position', () => {
    render(
      <PlayerProvider>
        <ListPage />
        <Clock />
      </PlayerProvider>,
    );
    const listBefore = listRendered.mock.calls.length;
    const clockBefore = clockRendered.mock.calls.length;
    // One report per act, as they arrive: each is its own render.
    for (let s = 1; s <= 10; s += 0.25) act(() => events!.onTime(s));
    expect(listRendered).toHaveBeenCalledTimes(listBefore);
    // The position's own reader still follows every report.
    expect(clockRendered.mock.calls.length).toBeGreaterThan(clockBefore + 30);
    expect(clockRendered).toHaveBeenLastCalledWith(10);
  });
});

describe('playhead reports and a closed view (the full-screen player)', () => {
  it('re-render nothing inside it while closed, and it follows again once open', () => {
    const view = (open: boolean) => (
      <PlayerProvider>
        <PlayheadFrozenContext.Provider value={!open}>
          <Clock />
        </PlayheadFrozenContext.Provider>
      </PlayerProvider>
    );
    const { rerender } = render(view(true));
    act(() => events!.onTime(2));
    expect(clockRendered).toHaveBeenLastCalledWith(2);
    rerender(view(false));
    const closedAt = clockRendered.mock.calls.length;
    for (let s = 3; s <= 10; s += 0.25) act(() => events!.onTime(s));
    expect(clockRendered).toHaveBeenCalledTimes(closedAt);
    // Held where it was while closed (no jump during the slide out).
    expect(clockRendered).toHaveBeenLastCalledWith(2);
    rerender(view(true));
    expect(clockRendered).toHaveBeenLastCalledWith(10);
    act(() => events!.onTime(11));
    expect(clockRendered).toHaveBeenLastCalledWith(11);
  });
});

describe('playhead reports and the provider itself', () => {
  it('do not re-render the provider; Discord presence still hears every report', () => {
    render(
      <PlayerProvider>
        <ListPage />
      </PlayerProvider>,
    );
    const before = providerRendered.mock.calls.length;
    const presenceBefore = presence.mock.calls.length;
    for (let s = 1; s <= 10; s += 0.25) act(() => events!.onTime(s));
    expect(providerRendered).toHaveBeenCalledTimes(before);
    expect(presence.mock.calls.length).toBeGreaterThan(presenceBefore + 30);
    expect(presence).toHaveBeenLastCalledWith(expect.objectContaining({ position: 10, isPlaying: true, current: SONG }));
  });

  it('in the Android app nothing on the page follows the playhead for Discord', () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true, getPlatform: () => 'android', Plugins: {} };
    try {
      render(
        <PlayerProvider>
          <ListPage />
        </PlayerProvider>,
      );
      const before = providerRendered.mock.calls.length;
      for (let s = 1; s <= 5; s += 0.25) act(() => events!.onTime(s));
      expect(presence).not.toHaveBeenCalled();
      expect(providerRendered).toHaveBeenCalledTimes(before);
    } finally {
      delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    }
  });
});

describe('playhead reports and the saved queue', () => {
  it('are not each written to localStorage with the whole queue', () => {
    const queue = Array.from({ length: 500 }, (_, i) => makeTrack({ id: `youtube:${i}`, title: `Song ${i}` }));
    usePlayerStore.setState({ queue, index: 0 });
    render(
      <PlayerProvider>
        <ListPage />
      </PlayerProvider>,
    );
    const write = vi.spyOn(localStorage, 'setItem');
    // 37 reports: none of them saves; the playhead is saved every 5 s while
    // shown, and on pause and leave (usePositionPersistence).
    for (let s = 1; s <= 10; s += 0.25) act(() => events!.onTime(s));
    expect(write.mock.calls.filter(([key]) => key === 'ember.player.v1').length).toBeLessThanOrEqual(1);
    expect(usePlayerStore.getState().position).toBe(10);
    write.mockRestore();
  });
});

describe('a volume drag', () => {
  it('does not re-render a usePlayer reader that does not show the volume', () => {
    render(
      <PlayerProvider>
        <ListPage />
      </PlayerProvider>,
    );
    const before = listRendered.mock.calls.length;
    // The slider reports every step of a drag.
    for (let v = 0.3; v <= 0.9; v += 0.05) act(() => usePlayerStore.getState().setVolume(v));
    expect(listRendered).toHaveBeenCalledTimes(before);
  });
});
