import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, waitFor } from '@testing-library/react';
import { PlayerProvider, usePlayer } from './PlayerProvider';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { makeFakeBackend } from '@/test-utils/fakeBackend';
import { GAIN_RAMP_MS, resetTrackGainsForTests } from '@/lib/playback/normalization';
import type { Track } from '@/types/track';

// Volume normalization end to end in the provider: the current song's
// measured gain reaches the engine as setVolume's normGain, follows the
// song, and the Settings switch turns it off. A new song's gain lands at
// once, before its audio loads; a gain that changes for the song already
// playing fades in (rampMs) instead of jumping.

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
  getTrackGain.mockImplementation(async (id: string) => ({ gainDb: gains[id] ?? null }));
  fake.setVolume.mockImplementation(() => {});
  fake.load.mockImplementation(() => {});
  // Playing: a mid-song change is heard, so it fades.
  fake.paused = false;
  window.localStorage.clear();
  resetTrackGainsForTests();
  gains[LOUD.id] = -4;
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
    await waitFor(() => expect(lastOpts()?.normGain).toBeCloseTo(0.631, 3));
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
    await waitFor(() => expect(lastOpts()?.normGain).toBeCloseTo(0.631, 3));
    act(() => useSettingsStore.setState({ normalizeVolume: false }));
    expect(lastOpts()?.normGain).toBe(1);
    act(() => useSettingsStore.setState({ normalizeVolume: true }));
    expect(lastOpts()?.normGain).toBeCloseTo(0.631, 3);
  });

  it('a gain that arrives after the song started fades in; a new song never fades', async () => {
    let answer: (v: { gainDb: number | null }) => void = () => {};
    getTrackGain.mockImplementation((id: string) =>
      id === LOUD.id ? new Promise((r) => { answer = r; }) : Promise.resolve({ gainDb: gains[id] ?? null }),
    );
    render(<PlayerProvider>{null}</PlayerProvider>);
    await waitFor(() => expect(fake.setVolume).toHaveBeenCalled());
    // Not known yet: unchanged, at once.
    expect(lastOpts()?.normGain).toBe(1);
    expect(lastOpts()?.rampMs ?? 0).toBe(0);
    await act(async () => answer({ gainDb: -4 }));
    expect(lastOpts()?.normGain).toBeCloseTo(0.631, 3);
    expect(lastOpts()?.rampMs).toBe(GAIN_RAMP_MS);
    // The next song's gain was fetched ahead: at once, no fade across songs.
    act(() => usePlayerStore.setState({ index: 1 }));
    expect(lastOpts()?.normGain).toBeCloseTo(1.585, 3);
    expect(lastOpts()?.rampMs ?? 0).toBe(0);
  });

  it('the switch fades the level instead of jumping', async () => {
    render(<PlayerProvider>{null}</PlayerProvider>);
    await waitFor(() => expect(lastOpts()?.normGain).toBeCloseTo(0.631, 3));
    act(() => useSettingsStore.setState({ normalizeVolume: false }));
    expect(lastOpts()).toMatchObject({ normGain: 1, rampMs: GAIN_RAMP_MS });
  });

  it('paused, nothing is heard: the gain changes at once', async () => {
    fake.paused = true;
    render(<PlayerProvider>{null}</PlayerProvider>);
    await waitFor(() => expect(lastOpts()?.normGain).toBeCloseTo(0.631, 3));
    expect(lastOpts()?.rampMs).toBeUndefined();
    act(() => useSettingsStore.setState({ normalizeVolume: false }));
    expect(lastOpts()?.rampMs).toBeUndefined();
  });

  it('the slider moves at once and does not restart a fade', async () => {
    render(<PlayerProvider>{null}</PlayerProvider>);
    await waitFor(() => expect(lastOpts()?.normGain).toBeCloseTo(0.631, 3));
    act(() => usePlayerStore.setState({ volume: 0.5 }));
    const [v, opts] = fake.setVolume.mock.calls.at(-1)!;
    expect(v).toBe(0.5);
    expect(opts?.rampMs ?? 0).toBe(0);
  });

  it('Next hands the engine the next song\'s known gain before its audio loads', async () => {
    let controls: ReturnType<typeof usePlayer> | null = null;
    function Grab() {
      controls = usePlayer();
      return null;
    }
    render(<PlayerProvider><Grab /></PlayerProvider>);
    await waitFor(() => expect(lastOpts()?.normGain).toBeCloseTo(0.631, 3));
    await waitFor(() => expect(getTrackGain).toHaveBeenCalledWith(QUIET.id));
    await act(async () => {});
    const order: string[] = [];
    fake.setVolume.mockImplementation((_v, o) => { order.push(`vol:${o?.normGain?.toFixed(3)}`); });
    fake.load.mockImplementation((url: string) => { order.push(`load:${url}`); });
    act(() => controls!.next());
    const loadAt = order.findIndex((e) => e.startsWith('load:') && e.includes(QUIET.sourceId));
    expect(loadAt).toBeGreaterThan(-1);
    // Without this, the loud song's -4 dB stayed on the engine until the
    // render after the skip, while the quiet song's audio was starting.
    expect(order.slice(0, loadAt).at(-1)).toBe('vol:1.585');
  });

  it('keeps the slider value and party gain separate from the song gain', async () => {
    useSettingsStore.setState({ partyVolume: true });
    render(<PlayerProvider>{null}</PlayerProvider>);
    await waitFor(() => expect(lastOpts()?.normGain).toBeCloseTo(0.631, 3));
    const [v, opts] = fake.setVolume.mock.calls.at(-1)!;
    expect(v).toBe(0.8);
    expect(opts?.gain).toBe(2);
  });
});
