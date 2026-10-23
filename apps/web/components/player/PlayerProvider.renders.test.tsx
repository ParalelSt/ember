/** The playhead's reports (several a second while audio plays) re-render
 *  only the views that show the position, not every usePlayer reader: each
 *  track list page reads usePlayer (useTrackActions), and a Liked list of
 *  thousands of rows was rebuilt on every report. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { PlayerProvider, usePlayer, usePlayerPosition } from './PlayerProvider';
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
