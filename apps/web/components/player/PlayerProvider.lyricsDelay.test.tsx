import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { PlayerProvider } from './PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { makeFakeBackend, makeTrack } from '@/test-utils/fakeBackend';

/** Skipping quickly must not start a lyrics lookup per song (the server
 *  limit answered 26 times with 429 in 7 minutes): the ambient lookup waits
 *  for the song to stay current. */

vi.mock('@/lib/api', () => ({ api: {}, apiUrl: (u: string) => u }));
const fake = makeFakeBackend();
vi.mock('@/lib/playback/webBackend', () => ({ createWebBackend: () => fake }));
vi.mock('@/components/providers/AuthProvider', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/hooks/useLibrary', () => ({
  useQueryHistory: () => ({ data: [] }),
  useQueryLikes: () => ({ data: [] }),
  useExecuteRecordPlay: () => ({ mutate: vi.fn() }),
}));
const lyrics = vi.hoisted(() => vi.fn((_t: unknown, _e: boolean) => ({ data: undefined })));
vi.mock('@/hooks/useLyrics', () => ({ useQueryLyrics: lyrics }));
vi.mock('@/hooks/player/useAvailabilityProbe', () => ({ useAvailabilityProbe: () => vi.fn() }));
vi.mock('@/hooks/player/useDiscordPresence', () => ({ useDiscordPresence: vi.fn() }));
vi.mock('@/hooks/player/useRadioExtend', () => ({ useRadioExtend: vi.fn() }));
vi.mock('@/hooks/player/useKeyboardShortcuts', () => ({ useKeyboardShortcuts: vi.fn() }));
vi.mock('@/hooks/player/useRemoteCommands', () => ({ useRemoteCommands: vi.fn() }));
vi.mock('@/hooks/pranks/usePresenceHeartbeat', () => ({ usePresenceHeartbeat: vi.fn() }));
vi.mock('@/hooks/pranks/usePrankInbox', () => ({ usePrankInbox: vi.fn() }));

const A = makeTrack({ id: 'youtube:a' });
const B = makeTrack({ id: 'youtube:b' });

/** Ids the hook was handed a track for while enabled. */
const lookedUp = () => new Set(lyrics.mock.calls.filter((c) => c[0] && c[1]).map((c) => (c[0] as { id: string }).id));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  usePlayerStore.setState({ queue: [A, B], index: 0, position: 0, isPlaying: false, duration: 0, context: null });
});
afterEach(() => vi.useRealTimers());

describe('PlayerProvider ambient lyrics lookup', () => {
  it('does not look up a song the moment it starts', () => {
    render(<PlayerProvider><span /></PlayerProvider>);
    expect(lookedUp().size).toBe(0);
  });

  it('looks it up once the song has stayed current for 4 s', () => {
    render(<PlayerProvider><span /></PlayerProvider>);
    act(() => { vi.advanceTimersByTime(3900); });
    expect(lookedUp().size).toBe(0);
    act(() => { vi.advanceTimersByTime(200); });
    expect([...lookedUp()]).toEqual([A.id]);
  });

  it('a song skipped before the delay is never looked up', () => {
    render(<PlayerProvider><span /></PlayerProvider>);
    act(() => { vi.advanceTimersByTime(2000); });
    act(() => { usePlayerStore.setState({ index: 1 }); });
    act(() => { vi.advanceTimersByTime(3000); });
    expect(lookedUp().size).toBe(0);
    act(() => { vi.advanceTimersByTime(1500); });
    expect([...lookedUp()]).toEqual([B.id]);
  });
});
