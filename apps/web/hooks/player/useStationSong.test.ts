import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { STATION_SONG_POLL_MS, useStationSong } from './useStationSong';
import { stationTrack } from '@/lib/radio/station';
import { makeTrack } from '@/test-utils/fakeBackend';
import type { Track } from '@/types/track';

const api = vi.hoisted(() => ({ radioNow: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

const ID = '00000000-0000-4000-8000-000000000001';
const station = stationTrack({ id: ID, name: 'Antena Zagreb', favicon: null, state: 'Grad Zagreb', country: 'Croatia' });
const other = stationTrack({ id: '00000000-0000-4000-8000-000000000002', name: 'Otvoreni', favicon: null });

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

function setup(track: Track | null, playing = true) {
  return renderHook((p: { track: Track | null; playing: boolean }) => useStationSong(p.track, p.playing), {
    initialProps: { track, playing },
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  api.radioNow.mockReset();
  api.radioNow.mockResolvedValue({ song: { artist: 'Severina', title: 'Italiana' } });
});
afterEach(() => vi.useRealTimers());

describe('useStationSong', () => {
  it('asks what the playing station is on at once, then every 30s', async () => {
    const { result } = setup(station);
    await flush();
    expect(api.radioNow).toHaveBeenCalledWith(ID);
    expect(result.current).toEqual({ artist: 'Severina', title: 'Italiana' });
    api.radioNow.mockResolvedValue({ song: { artist: 'Gibonni', title: 'Činim pravu stvar' } });
    await act(async () => { vi.advanceTimersByTime(STATION_SONG_POLL_MS); });
    await flush();
    expect(api.radioNow).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ artist: 'Gibonni', title: 'Činim pravu stvar' });
  });

  it('asks nothing for a song, or for a paused station', async () => {
    setup(makeTrack());
    setup(station, false);
    await flush();
    await act(async () => { vi.advanceTimersByTime(STATION_SONG_POLL_MS * 2); });
    expect(api.radioNow).not.toHaveBeenCalled();
  });

  it('stops asking when the station is paused', async () => {
    const { rerender } = setup(station);
    await flush();
    rerender({ track: station, playing: false });
    await act(async () => { vi.advanceTimersByTime(STATION_SONG_POLL_MS * 2); });
    expect(api.radioNow).toHaveBeenCalledTimes(1);
  });

  it('never carries one station\'s song over to the next', async () => {
    const { result, rerender } = setup(station);
    await flush();
    api.radioNow.mockReturnValue(new Promise(() => {}));
    rerender({ track: other, playing: true });
    expect(result.current).toBeNull();
  });

  it('keeps the last song when an ask fails', async () => {
    const { result } = setup(station);
    await flush();
    api.radioNow.mockRejectedValue(new Error('offline'));
    await act(async () => { vi.advanceTimersByTime(STATION_SONG_POLL_MS); });
    await flush();
    expect(result.current).toEqual({ artist: 'Severina', title: 'Italiana' });
  });
});
