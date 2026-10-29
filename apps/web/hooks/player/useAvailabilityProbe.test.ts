import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAvailabilityProbe } from './useAvailabilityProbe';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { makeTrack } from '@/test-utils/fakeBackend';
import { stationTrack } from '@/lib/radio/station';

const api = vi.hoisted(() => ({ getTrackAvailability: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

const logger = vi.hoisted(() => ({ breadcrumb: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logger/client', () => ({ logger }));

const reach = vi.hoisted(() => ({ serverUnreachable: vi.fn() }));
vi.mock('@/lib/playback/serverReach', () => reach);

const invalidateQueries = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

const dead = makeTrack({ id: 'youtube:dead', sourceId: 'dead', title: 'Gone' });
const live = makeTrack({ id: 'youtube:live', sourceId: 'live', title: 'Still Here' });

function setup(queue = [dead, live], index = 0, signedIn = true) {
  usePlayerStore.setState({ queue, index });
  const next = vi.fn();
  const nextRef = { current: next };
  const { result } = renderHook(() => useAvailabilityProbe(nextRef, undefined, signedIn));
  return { probe: result.current, next };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getTrackAvailability.mockResolvedValue({ unavailable: true, reason: 'removed' });
  usePlayerStore.setState({ queue: [], index: -1 });
});

describe('useAvailabilityProbe', () => {
  it('never flags a live radio station: it would not load right now, and says so', () => {
    const st = stationTrack({ id: '00000000-0000-4000-8000-000000000001', name: 'Live', favicon: null });
    const { probe, next } = setup([st, live], 0);
    const stillPlayable = vi.fn();
    probe(stillPlayable);
    expect(stillPlayable).toHaveBeenCalledWith(st);
    expect(api.getTrackAvailability).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().queue[0].unavailableAt).toBeFalsy();
  });

  it('flags the current track and skips on when the server says it is gone', async () => {
    const { probe, next } = setup();
    probe();

    await waitFor(() => expect(next).toHaveBeenCalledTimes(1));
    expect(api.getTrackAvailability).toHaveBeenCalledWith('youtube:dead');
    const flagged = usePlayerStore.getState().queue[0];
    expect(flagged.unavailableAt).toBeTruthy();
    expect(flagged.unavailableReason).toBe('removed');
    expect(invalidateQueries).toHaveBeenCalledTimes(3);
    expect(logger.breadcrumb).toHaveBeenCalledWith('playback', 'unavailable', {
      trackId: 'youtube:dead',
      reason: 'removed',
    });
  });

  it('does nothing when the server says the track is fine', async () => {
    api.getTrackAvailability.mockResolvedValue({ unavailable: false, reason: null });
    const { probe, next } = setup();
    probe();

    await waitFor(() => expect(api.getTrackAvailability).toHaveBeenCalled());
    expect(next).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().queue[0].unavailableAt).toBeUndefined();
  });

  it('says the song would not load when the server has nothing against it', async () => {
    api.getTrackAvailability.mockResolvedValue({ unavailable: false, reason: null });
    const { probe, next } = setup();
    const stillPlayable = vi.fn();
    probe(stillPlayable);

    // The listener is owed a word: the player has stopped and the queue has
    // not moved, so without this nothing on screen explains itself.
    await waitFor(() => expect(stillPlayable).toHaveBeenCalledTimes(1));
    expect(stillPlayable.mock.calls[0][0].title).toBe('Gone');
    expect(next).not.toHaveBeenCalled();
  });

  it('says the same when the server cannot be asked at all', async () => {
    api.getTrackAvailability.mockRejectedValue(new Error('offline'));
    const { probe } = setup();
    const stillPlayable = vi.fn();
    probe(stillPlayable);

    await waitFor(() => expect(stillPlayable).toHaveBeenCalledTimes(1));
  });

  it('does not double up on a track the server confirms is gone', async () => {
    const { probe, next } = setup();
    const stillPlayable = vi.fn();
    probe(stillPlayable);

    // That track gets the skip message instead; two messages for one song
    // would be worse than none.
    await waitFor(() => expect(next).toHaveBeenCalledTimes(1));
    expect(stillPlayable).not.toHaveBeenCalled();
  });

  it('never asks about a track already known to be unavailable', () => {
    const known = { ...dead, unavailableAt: '2026-09-09T00:00:00.000Z' };
    const { probe, next } = setup([known, live]);
    probe();

    expect(api.getTrackAvailability).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('does nothing when there is no current track', () => {
    const { probe } = setup([], -1);
    probe();
    expect(api.getTrackAvailability).not.toHaveBeenCalled();
  });

  it('flags but does not skip when the answer arrives after the user moved on', async () => {
    const { probe, next } = setup();
    probe();
    // The listener hit Next while the request was in flight.
    usePlayerStore.setState({ index: 1 });

    await waitFor(() => expect(usePlayerStore.getState().queue[0].unavailableAt).toBeTruthy());
    expect(next).not.toHaveBeenCalled();
  });

  it('says nothing about a song the listener already moved on from (no stuck "Tap to retry" over the next song)', async () => {
    api.getTrackAvailability.mockResolvedValue({ unavailable: false, reason: null });
    const { probe } = setup();
    const stillPlayable = vi.fn();
    probe(stillPlayable);
    // The listener hit Next while the request was in flight.
    usePlayerStore.setState({ index: 1 });

    await waitFor(() => expect(api.getTrackAvailability).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(stillPlayable).not.toHaveBeenCalled();
  });

  it('the same when the server could not be asked and the listener moved on', async () => {
    api.getTrackAvailability.mockRejectedValue(new Error('offline'));
    const { probe } = setup();
    const stillPlayable = vi.fn();
    probe(stillPlayable);
    usePlayerStore.setState({ index: 1 });

    await waitFor(() => expect(api.getTrackAvailability).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(stillPlayable).not.toHaveBeenCalled();
  });

  it('leaves the queue alone when the track is gone from it entirely', async () => {
    const { probe, next } = setup();
    probe();
    usePlayerStore.setState({ queue: [live], index: 0 });

    await waitFor(() => expect(api.getTrackAvailability).toHaveBeenCalled());
    expect(next).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().queue).toEqual([live]);
  });

  it('offline: asks nobody, flags nothing, says nothing, and moves on', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    try {
      const { probe, next } = setup();
      const onStillPlayable = vi.fn();
      probe(onStillPlayable);

      expect(api.getTrackAvailability).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
      expect(onStillPlayable).not.toHaveBeenCalled();
      expect(usePlayerStore.getState().queue[0].unavailableAt).toBeUndefined();
      expect(logger.breadcrumb).toHaveBeenCalledWith('playback', 'probe-skipped-offline', { trackId: 'youtube:dead' });
    } finally {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    }
  });
});

describe('useAvailabilityProbe offline, with a handler', () => {
  it('hands the failed track to it instead of calling Next', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    try {
      usePlayerStore.setState({ queue: [dead, live], index: 0 });
      const next = vi.fn();
      const onOffline = vi.fn();
      const { result } = renderHook(() => useAvailabilityProbe({ current: next }, { current: onOffline }));
      result.current();
      expect(onOffline).toHaveBeenCalledWith(dead);
      expect(next).not.toHaveBeenCalled();
      expect(api.getTrackAvailability).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    }
  });
});

describe('useAvailabilityProbe [bughunt V5]: signed out', () => {
  it('does not ask the server (the answer needs a session), just says it would not load', async () => {
    const { probe, next } = setup([dead, live], 0, false);
    const stillPlayable = vi.fn();
    probe(stillPlayable);
    await waitFor(() => expect(stillPlayable).toHaveBeenCalledTimes(1));
    expect(api.getTrackAvailability).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });
});

describe('useAvailabilityProbe: flags the provider makes itself', () => {
  it('hands out the list refresh, for songs the Android player or a prefetch found gone', () => {
    const refreshRef = { current: () => {} };
    renderHook(() => useAvailabilityProbe({ current: vi.fn() }, undefined, true, refreshRef));
    refreshRef.current();
    expect(invalidateQueries).toHaveBeenCalledTimes(3);
  });

  it('a dead song still playing goes to the provider\'s handler, with the reason, instead of Next', async () => {
    const { probe, next } = setup();
    const onDead = vi.fn();
    probe(undefined, onDead);
    await waitFor(() => expect(onDead).toHaveBeenCalledWith(expect.objectContaining({ id: 'youtube:dead' }), 'removed'));
    expect(next).not.toHaveBeenCalled();
  });
});

/** The browser says online, but nothing gets through (a weak mobile
 *  signal): the question about the song gets no answer at all. That is the
 *  connection, not the song, so it goes the offline way. */
describe('useAvailabilityProbe: no answer from the server at all', () => {
  function withHandler(queue = [dead, live], index = 0) {
    usePlayerStore.setState({ queue, index });
    const next = vi.fn();
    const onOffline = vi.fn();
    const { result } = renderHook(() => useAvailabilityProbe({ current: next }, { current: onOffline }));
    return { probe: result.current, next, onOffline };
  }

  it('puts the player offline and hands the track to the offline handler', async () => {
    api.getTrackAvailability.mockRejectedValue(new TypeError('Failed to fetch'));
    const { probe, next, onOffline } = withHandler();
    const stillPlayable = vi.fn();
    probe(stillPlayable);
    await waitFor(() => expect(onOffline).toHaveBeenCalledWith(dead));
    expect(reach.serverUnreachable).toHaveBeenCalledTimes(1);
    expect(stillPlayable).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().queue[0].unavailableAt).toBeUndefined();
    expect(logger.breadcrumb).toHaveBeenCalledWith('playback', 'probe-unreachable', { trackId: 'youtube:dead' });
  });

  it('an HTTP error is an answer: the song just would not load', async () => {
    api.getTrackAvailability.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    const { probe, onOffline } = withHandler();
    const stillPlayable = vi.fn();
    probe(stillPlayable);
    await waitFor(() => expect(stillPlayable).toHaveBeenCalledTimes(1));
    expect(onOffline).not.toHaveBeenCalled();
    expect(reach.serverUnreachable).not.toHaveBeenCalled();
  });

  // A server restart is not the device going offline: the Funnel's 502 is
  // something answering, so the song stops with "tap to retry", as before,
  // instead of skipping to a downloaded song.
  it('a gateway answering for Ember (502, no JSON) is the song not loading, not offline', async () => {
    api.getTrackAvailability.mockRejectedValue(Object.assign(new Error("Can't reach Ember right now."), { answered: 502 }));
    const { probe, onOffline } = withHandler();
    const stillPlayable = vi.fn();
    probe(stillPlayable);
    await waitFor(() => expect(stillPlayable).toHaveBeenCalledTimes(1));
    expect(onOffline).not.toHaveBeenCalled();
    expect(reach.serverUnreachable).not.toHaveBeenCalled();
  });

  // A Wi-Fi sign-in page's 200 HTML means the internet is out of reach:
  // offline, and the downloaded songs play.
  it('a sign-in page answering 200 goes the offline way', async () => {
    api.getTrackAvailability.mockRejectedValue(Object.assign(new Error("Can't reach Ember right now."), { answered: 200 }));
    const { probe, onOffline } = withHandler();
    const stillPlayable = vi.fn();
    probe(stillPlayable);
    await waitFor(() => expect(onOffline).toHaveBeenCalledWith(dead));
    expect(reach.serverUnreachable).toHaveBeenCalledTimes(1);
    expect(stillPlayable).not.toHaveBeenCalled();
  });

  it('a song the listener already moved on from is left where it is', async () => {
    let fail: (e: unknown) => void = () => {};
    api.getTrackAvailability.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    const { probe, onOffline } = withHandler();
    probe(vi.fn());
    usePlayerStore.setState({ index: 1 });
    fail(new TypeError('Failed to fetch'));
    await waitFor(() => expect(reach.serverUnreachable).toHaveBeenCalledTimes(1));
    expect(onOffline).not.toHaveBeenCalled();
  });
});
