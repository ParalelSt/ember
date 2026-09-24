/** Discord presence through the real provider: what the card is told when the
 *  song changes at 2:45.
 *
 *  The owner's report: skip a song at 2:45 and Discord shows the next song,
 *  still at 2:45. The payload is asserted where it leaves the app (the web
 *  route's client call; the desktop command gets the same numbers), with the
 *  real useDiscordPresence and publishDiscordPresence in between. */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { PlayerProvider, usePlayer } from './PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { usePrivacyStore } from '@/stores/usePrivacyStore';
import { makeFakeBackend, makeTrack } from '@/test-utils/fakeBackend';
import type { AudioBackendEvents, LoadOptions } from '@/lib/playback/types';

const discord = vi.hoisted(() => ({ updateDiscord: vi.fn(() => Promise.resolve({ ok: true, shared: true })) }));
vi.mock('@/lib/api', () => ({ api: discord, apiUrl: (u: string) => u }));
vi.mock('@/lib/logger/client', () => ({
  logger: { boot: vi.fn(), setContext: vi.fn(), breadcrumb: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

const fake = makeFakeBackend();
fake.load = vi.fn((_url: string, opts: LoadOptions) => {
  if (opts.autoplay) fake.play();
});
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

const FIRST = makeTrack({ id: 'youtube:first', title: 'First', durationSec: 200 });
const SECOND = makeTrack({ id: 'youtube:second', title: 'Second', durationSec: 240 });
const THIRD = makeTrack({ id: 'youtube:third', title: 'Third', durationSec: 180 });

function Harness() {
  const { next } = usePlayer();
  return <button onClick={next}>next</button>;
}

/** [title, playing, position, duration] of every presence update sent. */
function sent() {
  return discord.updateDiscord.mock.calls.map((c) => {
    const [track, playing, pos, dur] = c as unknown as [{ title: string } | null, boolean, number, number];
    return [track?.title ?? null, playing, pos, dur];
  });
}

/** Mount with FIRST playing at 2:45, and forget the presence it sent. */
function playingFirstAt(sec: number) {
  render(
    <PlayerProvider>
      <Harness />
    </PlayerProvider>,
  );
  act(() => {
    for (let s = sec - 2; s <= sec; s += 0.25) events!.onTime(s);
  });
  discord.updateDiscord.mockClear();
}

beforeEach(() => {
  vi.clearAllMocks();
  events = null;
  fake.currentTime = 0;
  fake.durationSec = 200;
  fake.paused = false;
  usePrivacyStore.setState({ shareDiscord: true });
  usePlayerStore.setState({
    queue: [FIRST, SECOND, THIRD],
    index: 0,
    position: 0,
    duration: 200,
    isPlaying: true,
    context: null,
    baseCount: 3,
    loopMode: 'off',
  });
});

describe('Discord presence on a song change at 2:45', () => {
  it('Next sends the next song at 0:00', () => {
    playingFirstAt(165);
    fireEvent.click(screen.getByText('next'));
    expect(sent()).toEqual([['Second', true, 0, 240]]);
  });

  it('a change the provider loads itself sends 0:00, not the previous song\'s 2:45', () => {
    // The playing song removed from the queue (a playlist edit): the index
    // now points at the next song and the provider's own effect loads it.
    // Same route as any change that did not come from Next/Prev/a tap.
    playingFirstAt(165);
    act(() => {
      usePlayerStore.setState({ queue: [SECOND, THIRD], index: 0 });
    });
    expect(sent()).toEqual([['Second', true, 0, 240]]);

    // The new song's own clock starts: nothing about it contradicts 0:00.
    act(() => {
      events!.onTime(0.25);
      events!.onTime(0.5);
    });
    expect(sent()).toEqual([['Second', true, 0, 240]]);
  });

  it('a late position event from the previous song does not put 2:45 back', () => {
    playingFirstAt(165);
    fireEvent.click(screen.getByText('next'));
    act(() => events!.onTime(165.25));
    act(() => events!.onTime(0.25));
    expect(sent()).toEqual([['Second', true, 0, 240]]);
  });

  it('seek, pause and resume in the new song still reach Discord', () => {
    playingFirstAt(165);
    fireEvent.click(screen.getByText('next'));
    act(() => events!.onTime(0.25));
    // A seek (the engine reports the jump).
    act(() => events!.onTime(60));
    expect(sent().at(-1)).toEqual(['Second', true, 60, 240]);
    // Pause clears the card; resume republishes from the same spot.
    act(() => events!.onPause());
    expect(sent().at(-1)).toEqual(['Second', false, 60, 240]);
    act(() => events!.onPlay());
    expect(sent().at(-1)).toEqual(['Second', true, 60, 240]);
  });
});
