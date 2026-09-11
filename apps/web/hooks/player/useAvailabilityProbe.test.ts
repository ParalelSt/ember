import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useAvailabilityProbe } from './useAvailabilityProbe';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { makeTrack } from '@/test-utils/fakeBackend';

const api = vi.hoisted(() => ({ getTrackAvailability: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

const logger = vi.hoisted(() => ({ breadcrumb: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logger/client', () => ({ logger }));

const invalidateQueries = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

const dead = makeTrack({ id: 'youtube:dead', sourceId: 'dead', title: 'Gone' });
const live = makeTrack({ id: 'youtube:live', sourceId: 'live', title: 'Still Here' });

function setup(queue = [dead, live], index = 0) {
  usePlayerStore.setState({ queue, index });
  const next = vi.fn();
  const nextRef = { current: next };
  const { result } = renderHook(() => useAvailabilityProbe(nextRef));
  return { probe: result.current, next };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getTrackAvailability.mockResolvedValue({ unavailable: true, reason: 'removed' });
  usePlayerStore.setState({ queue: [], index: -1 });
});

describe('useAvailabilityProbe', () => {
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

  it('leaves the queue alone when the track is gone from it entirely', async () => {
    const { probe, next } = setup();
    probe();
    usePlayerStore.setState({ queue: [live], index: 0 });

    await waitFor(() => expect(api.getTrackAvailability).toHaveBeenCalled());
    expect(next).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().queue).toEqual([live]);
  });
});
