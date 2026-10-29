import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDiscordPresence } from './useDiscordPresence';
import { makeTrack } from '@/test-utils/fakeBackend';
import { stationTrack } from '@/lib/radio/station';

const presence = vi.hoisted(() => ({ publishDiscordPresence: vi.fn() }));
vi.mock('@/lib/discordPresence', () => presence);
// The station's song, as the poll last heard it.
const heard = vi.hoisted(() => ({ song: null as { artist: string | null; title: string } | null }));
vi.mock('@/hooks/player/useStationSong', () => ({ useStationSong: () => heard.song }));

const a = makeTrack();
const b = makeTrack({ id: 'youtube:b2', sourceId: 'b2', title: 'Second Song' });
// A longer song, so a test can tell its own length from the previous one's.
const c = makeTrack({ id: 'youtube:c3', sourceId: 'c3', title: 'Third Song', durationSec: 240 });

interface Props {
  current: typeof a | null;
  isPlaying: boolean;
  position: number;
  duration: number;
}

const DURATION = 191;

function setup(over: Partial<Props> = {}) {
  const initialProps: Props = {
    current: a,
    isPlaying: true,
    position: 0,
    duration: DURATION,
    ...over,
  };
  return renderHook((p: Props) => useDiscordPresence(p), { initialProps });
}

beforeEach(() => {
  vi.clearAllMocks();
  heard.song = null;
});

describe('useDiscordPresence', () => {
  it('publishes the current track, with the playhead, on mount', () => {
    setup({ position: 12 });
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(1);
    expect(presence.publishDiscordPresence).toHaveBeenCalledWith(a, true, 12, DURATION);
  });

  it('publishes again when the track changes', () => {
    const { rerender } = setup();
    rerender({ current: b, isPlaying: true, position: 0, duration: DURATION });
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(2);
    expect(presence.publishDiscordPresence).toHaveBeenLastCalledWith(b, true, 0, DURATION);
  });

  it('publishes again when playback pauses or resumes', () => {
    const { rerender } = setup();
    rerender({ current: a, isPlaying: false, position: 0, duration: DURATION });
    expect(presence.publishDiscordPresence).toHaveBeenLastCalledWith(a, false, 0, DURATION);
    rerender({ current: a, isPlaying: true, position: 0, duration: DURATION });
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(3);
  });

  it('does not republish on a normal position tick', () => {
    // The provider re-renders on every timeupdate; a new object for the SAME
    // song, a second further in, must not reach Discord.
    const { rerender } = setup();
    rerender({ current: { ...a }, isPlaying: true, position: 1, duration: DURATION });
    rerender({ current: { ...a }, isPlaying: true, position: 2, duration: DURATION });
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(1);
  });

  it('publishes on a seek jump, so the card time bar follows', () => {
    const { rerender } = setup();
    rerender({ current: a, isPlaying: true, position: 1, duration: DURATION });
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(1);

    rerender({ current: a, isPlaying: true, position: 90, duration: DURATION });
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(2);
    expect(presence.publishDiscordPresence).toHaveBeenLastCalledWith(a, true, 90, DURATION);
  });

  it('publishes on a backwards seek too', () => {
    const { rerender } = setup({ position: 90 });
    rerender({ current: a, isPlaying: true, position: 5, duration: DURATION });
    expect(presence.publishDiscordPresence).toHaveBeenLastCalledWith(a, true, 5, DURATION);
  });

  it('does not treat a track change as a seek (one publish, not two)', () => {
    const { rerender } = setup({ position: 120 });
    rerender({ current: c, isPlaying: true, position: 0, duration: 240 });
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(2);
    expect(presence.publishDiscordPresence).toHaveBeenLastCalledWith(c, true, 0, 240);
  });

  it('does not publish a seek while paused', () => {
    const { rerender } = setup({ isPlaying: false });
    rerender({ current: a, isPlaying: false, position: 90, duration: DURATION });
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(1);
  });

  it('publishes a cleared presence when the queue empties', () => {
    const { rerender } = setup();
    rerender({ current: null, isPlaying: false, position: 0, duration: 0 });
    expect(presence.publishDiscordPresence).toHaveBeenLastCalledWith(null, false, 0, 0);
  });

  it('starts a cold start at the stored playhead (no song before it)', () => {
    const { rerender } = setup({ current: null, isPlaying: false, position: 0 });
    rerender({ current: a, isPlaying: true, position: 90, duration: DURATION });
    expect(presence.publishDiscordPresence).toHaveBeenLastCalledWith(a, true, 90, DURATION);
  });
});

/** The owner's report: a song playing at 2:45 is skipped, Discord shows the
 *  next song but keeps 2:45. The render that changes the song can still hold
 *  the previous song's playhead (and length): the provider resets the store's
 *  playhead in an effect for changes it loads itself, and a native player
 *  reports its own position after the index. */
describe('useDiscordPresence: skipping at 2:45', () => {
  const OLD = 165;

  function playingAt(sec: number) {
    const r = setup({ position: sec });
    vi.clearAllMocks();
    return r;
  }

  it('publishes the new song at 0:00 even when the playhead still reads 2:45', () => {
    const { rerender } = playingAt(OLD);
    rerender({ current: c, isPlaying: true, position: OLD, duration: DURATION });
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(1);
    // The new song's own length too, not the previous song's.
    expect(presence.publishDiscordPresence).toHaveBeenLastCalledWith(c, true, 0, 240);
  });

  it('stays at 0:00 once the playhead resets and the new song starts ticking', () => {
    const { rerender } = playingAt(OLD);
    rerender({ current: c, isPlaying: true, position: OLD, duration: DURATION });
    rerender({ current: c, isPlaying: true, position: 0, duration: 240 });
    rerender({ current: c, isPlaying: true, position: 0.25, duration: 240 });
    rerender({ current: c, isPlaying: true, position: 0.5, duration: 240 });
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(1);
    expect(presence.publishDiscordPresence).toHaveBeenLastCalledWith(c, true, 0, 240);
  });

  it('ignores a late report from the previous song after the change', () => {
    // The desktop engine can have one position event of the old song in
    // flight when the new one is loaded.
    const { rerender } = playingAt(OLD - 0.25);
    rerender({ current: c, isPlaying: true, position: 0, duration: 240 });
    rerender({ current: c, isPlaying: true, position: OLD, duration: 240 });
    rerender({ current: c, isPlaying: true, position: 0.25, duration: 240 });
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(1);
    expect(presence.publishDiscordPresence).toHaveBeenLastCalledWith(c, true, 0, 240);
  });

  it('still publishes a seek in the new song', () => {
    const { rerender } = playingAt(OLD);
    rerender({ current: c, isPlaying: true, position: OLD, duration: DURATION });
    rerender({ current: c, isPlaying: true, position: 0.25, duration: 240 });
    rerender({ current: c, isPlaying: true, position: 60, duration: 240 });
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(2);
    expect(presence.publishDiscordPresence).toHaveBeenLastCalledWith(c, true, 60, 240);
  });

  it('publishes a seek back to where the previous song was, once the new song is ticking', () => {
    const { rerender } = playingAt(OLD);
    rerender({ current: c, isPlaying: true, position: OLD, duration: DURATION });
    rerender({ current: c, isPlaying: true, position: 0.25, duration: 240 });
    rerender({ current: c, isPlaying: true, position: OLD, duration: 240 });
    expect(presence.publishDiscordPresence).toHaveBeenLastCalledWith(c, true, OLD, 240);
  });

  it('pause and resume in the new song carry its own playhead', () => {
    const { rerender } = playingAt(OLD);
    rerender({ current: c, isPlaying: true, position: OLD, duration: DURATION });
    rerender({ current: c, isPlaying: true, position: 0.25, duration: 240 });
    rerender({ current: c, isPlaying: true, position: 12, duration: 240 });
    vi.clearAllMocks();
    rerender({ current: c, isPlaying: false, position: 12, duration: 240 });
    expect(presence.publishDiscordPresence).toHaveBeenLastCalledWith(c, false, 12, 240);
    rerender({ current: c, isPlaying: true, position: 12, duration: 240 });
    expect(presence.publishDiscordPresence).toHaveBeenLastCalledWith(c, true, 12, 240);
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(2);
  });

  it('a skip while paused publishes the new song at 0:00 when it starts', () => {
    const { rerender } = playingAt(OLD);
    rerender({ current: a, isPlaying: false, position: OLD, duration: DURATION });
    rerender({ current: c, isPlaying: false, position: OLD, duration: DURATION });
    rerender({ current: c, isPlaying: true, position: OLD, duration: DURATION });
    expect(presence.publishDiscordPresence).toHaveBeenLastCalledWith(c, true, 0, 240);
  });

  it('republishes when the Discord switch changes, so turning it on or off shows at once', async () => {
    const { usePrivacyStore } = await import('@/stores/usePrivacyStore');
    const { act } = await import('@testing-library/react');
    usePrivacyStore.setState({ shareDiscord: false });
    const { rerender } = setup({ position: 0 });
    rerender({ current: a, isPlaying: true, position: 40, duration: DURATION });
    rerender({ current: a, isPlaying: true, position: 41, duration: DURATION });
    presence.publishDiscordPresence.mockClear();

    // The settings load (or the member flips the switch) mid-song.
    act(() => usePrivacyStore.setState({ shareDiscord: true }));
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(1);
    expect(presence.publishDiscordPresence).toHaveBeenLastCalledWith(a, true, 41, DURATION);

    act(() => usePrivacyStore.setState({ shareDiscord: false }));
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(2);
  });
});


describe('useDiscordPresence for a radio station', () => {
  const station = stationTrack({ id: '00000000-0000-4000-8000-000000000001', name: 'Antena Zagreb', favicon: 'https://antena.example/logo.png', state: 'Grad Zagreb', country: 'Croatia' });
  const other = stationTrack({ id: '00000000-0000-4000-8000-000000000002', name: 'Otvoreni', favicon: null });
  const lastTrack = () => presence.publishDiscordPresence.mock.calls.at(-1)![0];

  it('shows the station as before until a song is heard, then the song like a song', () => {
    const { rerender } = setup({ current: station, duration: 0 });
    expect(lastTrack()).toMatchObject({ title: 'Antena Zagreb', artist: 'Grad Zagreb, Croatia' });

    heard.song = { artist: 'Severina', title: 'Italiana' };
    rerender({ current: station, isPlaying: true, position: 1, duration: 0 });
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(2);
    expect(lastTrack()).toMatchObject({ title: 'Italiana', artist: 'Severina', album: 'Antena Zagreb', artworkUrl: 'https://antena.example/logo.png' });
    expect(presence.publishDiscordPresence.mock.calls.at(-1)!.slice(1)).toEqual([true, 1, 0]);
  });

  it('publishes the next song on the same station, and nothing when it is the same one again', () => {
    heard.song = { artist: 'Severina', title: 'Italiana' };
    const { rerender } = setup({ current: station, duration: 0 });
    expect(lastTrack()).toMatchObject({ title: 'Italiana' });
    rerender({ current: station, isPlaying: true, position: 1, duration: 0 });
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(1);

    heard.song = { artist: 'Gibonni', title: 'Činim pravu stvar' };
    rerender({ current: station, isPlaying: true, position: 2, duration: 0 });
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(2);
    expect(lastTrack()).toMatchObject({ title: 'Činim pravu stvar', artist: 'Gibonni', album: 'Antena Zagreb' });
  });

  it('publishes a change of station once, from the track change', () => {
    heard.song = { artist: 'Severina', title: 'Italiana' };
    const { rerender } = setup({ current: station, duration: 0 });
    heard.song = null;
    rerender({ current: other, isPlaying: true, position: 0, duration: 0 });
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(2);
    expect(lastTrack()).toMatchObject({ title: 'Otvoreni' });
  });

  it('does not publish a song heard while paused', () => {
    const { rerender } = setup({ current: station, isPlaying: false, duration: 0 });
    heard.song = { artist: 'Severina', title: 'Italiana' };
    rerender({ current: station, isPlaying: false, position: 0, duration: 0 });
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(1);
  });
});
