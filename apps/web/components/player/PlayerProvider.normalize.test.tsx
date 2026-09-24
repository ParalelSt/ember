import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { PlayerProvider } from './PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { makeFakeBackend } from '@/test-utils/fakeBackend';
import { resetTrackGainsForTests } from '@/lib/playback/normalization';
import type { Track } from '@/types/track';

// Volume normalization end to end in the provider: the current song's
// measured gain reaches the engine as setVolume's normGain, follows the
// song, and the Settings switch turns it off.

const gains: Record<string, number | null> = {};
const getTrackGain = vi.fn(async (id: string) => ({ gainDb: gains[id] ?? null }));
vi.mock('@/lib/api', () => ({
  api: { getTrackGain: (id: string) => getTrackGain(id) },
  apiUrl: (u: string) => u,
}));
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
vi.mock('./PrankReceiver', () => ({ PrankReceiver: () => null }));

const track = (videoId: string): Track => ({
  id: `youtube:${videoId}`,
  source: 'youtube',
  sourceId: videoId,
  title: videoId,
  artist: 'A',
  artistId: null,
  album: null,
  albumId: null,
  durationSec: 200,
  artworkUrl: null,
  streamUrl: `/api/youtube/stream/${videoId}`,
}) as Track;

const LOUD = track('loudloudlou');
const QUIET = track('quietquietq');
const NEW = track('newnewnewne');

const lastOpts = () => fake.setVolume.mock.calls.at(-1)?.[1];

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  resetTrackGainsForTests();
  gains[LOUD.id] = -6;
  gains[QUIET.id] = 4;
  gains[NEW.id] = null;
  useSettingsStore.setState({ partyVolume: false, normalizeVolume: true });
  usePlayerStore.setState({
    queue: [LOUD, QUIET, NEW], index: 0, position: 0, isPlaying: false, duration: 0, volume: 0.8, muted: false,
  });
});

describe('PlayerProvider: volume normalization', () => {
  it('hands the engine the current song gain, and follows the song', async () => {
    render(<PlayerProvider>{null}</PlayerProvider>);
    await waitFor(() => expect(lastOpts()?.normGain).toBeCloseTo(0.501, 3));
    // The next song was asked about ahead of time...
    expect(getTrackGain).toHaveBeenCalledWith(QUIET.id);
    // ...so its gain is in place the moment it becomes current.
    act(() => usePlayerStore.setState({ index: 1 }));
    expect(lastOpts()?.normGain).toBeCloseTo(1.585, 3);
    // A song not measured yet plays unchanged, not at the last song's level.
    act(() => usePlayerStore.setState({ index: 2 }));
    expect(lastOpts()?.normGain).toBe(1);
    expect(lastOpts()?.gain).toBe(1);
  });

  it('the Settings switch turns it off and back on', async () => {
    render(<PlayerProvider>{null}</PlayerProvider>);
    await waitFor(() => expect(lastOpts()?.normGain).toBeCloseTo(0.501, 3));
    act(() => useSettingsStore.setState({ normalizeVolume: false }));
    expect(lastOpts()?.normGain).toBe(1);
    act(() => useSettingsStore.setState({ normalizeVolume: true }));
    expect(lastOpts()?.normGain).toBeCloseTo(0.501, 3);
  });

  it('keeps the slider value and party gain separate from the song gain', async () => {
    useSettingsStore.setState({ partyVolume: true });
    render(<PlayerProvider>{null}</PlayerProvider>);
    await waitFor(() => expect(lastOpts()?.normGain).toBeCloseTo(0.501, 3));
    const [v, opts] = fake.setVolume.mock.calls.at(-1)!;
    expect(v).toBe(0.8);
    expect(opts?.gain).toBe(2);
  });
});
