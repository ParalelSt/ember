import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { usePlayerStore, type LoopMode } from '@/stores/usePlayerStore';
import { useSessionStore } from '@/stores/useSessionStore';
import { useRadioExtend } from './useRadioExtend';
import { makeTrack } from '@/test-utils/fakeBackend';
import type { PlaybackContext, Track } from '@/types/track';

const api = vi.hoisted(() => ({ getRecommended: vi.fn() }));
vi.mock('@/lib/api', () => ({ api }));

const logger = vi.hoisted(() => ({ breadcrumb: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/logger/client', () => ({ logger }));

const seed = makeTrack({ id: 'youtube:seed', sourceId: 'seed', title: 'Seed Song' });
const rec1 = makeTrack({ id: 'youtube:r1', sourceId: 'r1', title: 'Rec One' });
const rec2 = makeTrack({ id: 'youtube:r2', sourceId: 'r2', title: 'Rec Two' });

interface Props {
  current: Track | null;
  queue: Track[];
  index: number;
  loopMode: LoopMode;
  context: PlaybackContext | null;
}

const base: Props = {
  current: seed,
  queue: [seed],
  index: 0,
  loopMode: 'off',
  context: { type: 'single' },
};

function setup(over: Partial<Props> = {}) {
  const initialProps = { ...base, ...over };
  usePlayerStore.setState({ queue: initialProps.queue, index: initialProps.index });
  return renderHook(
    (p: Props) => useRadioExtend({ ...p, history: [], liked: [] }),
    { initialProps },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  api.getRecommended.mockResolvedValue({ tracks: [rec1, rec2] });
  usePlayerStore.setState({ queue: [], index: -1, orderBackup: null, shuffle: false });
  useSessionStore.setState({ hostingSessionId: null });
});

describe('useRadioExtend', () => {
  it('extends the queue at the end of the queue with loop off', async () => {
    setup();
    await waitFor(() => expect(usePlayerStore.getState().queue).toHaveLength(3));
    expect(api.getRecommended).toHaveBeenCalledWith('seed');
    expect(api.getRecommended).toHaveBeenCalledTimes(1);
    expect(usePlayerStore.getState().queue.map((t) => t.id)).toEqual([
      'youtube:seed', 'youtube:r1', 'youtube:r2',
    ]);
    expect(logger.breadcrumb).toHaveBeenCalledWith('radio', 'extend', {
      context: 'single', seed: 'seed', recs: 2, added: 2,
    });
  });

  it('does not fetch while loop-all is on, and fetches when it goes off', async () => {
    const { rerender } = setup({ loopMode: 'all' });
    expect(api.getRecommended).not.toHaveBeenCalled();
    // Turning loop off must re-run the effect, otherwise a 1-track queue stays
    // 1 track forever.
    rerender({ ...base, loopMode: 'off' });
    await waitFor(() => expect(api.getRecommended).toHaveBeenCalledTimes(1));
  });

  it('does not extend the queue of a hosted session', () => {
    useSessionStore.setState({ hostingSessionId: 'sess1' });
    setup();
    expect(api.getRecommended).not.toHaveBeenCalled();
  });

  it('does nothing away from the end of the queue', () => {
    setup({ queue: [seed, rec1], index: 0 });
    expect(api.getRecommended).not.toHaveBeenCalled();
  });

  it('does nothing with no current track', () => {
    setup({ current: null, queue: [], index: -1 });
    expect(api.getRecommended).not.toHaveBeenCalled();
  });

  it('does not fetch the same seed twice while a fetch is in flight', async () => {
    const { rerender } = setup();
    // A re-render with a new queue array (the same content) is exactly what a
    // store write causes; it must not start a second fetch for this seed.
    rerender({ ...base, queue: [seed] });
    rerender({ ...base, queue: [seed] });
    await waitFor(() => expect(usePlayerStore.getState().queue).toHaveLength(3));
    expect(api.getRecommended).toHaveBeenCalledTimes(1);
  });

  it('keeps the shuffle snapshot in step when shuffle is on', async () => {
    usePlayerStore.setState({ orderBackup: [seed] });
    setup();
    await waitFor(() => expect(usePlayerStore.getState().orderBackup).toHaveLength(3));
    expect(usePlayerStore.getState().orderBackup!.map((t) => t.id)).toEqual([
      'youtube:seed', 'youtube:r1', 'youtube:r2',
    ]);
  });

  it('leaves the queue alone when nothing survives the ranking', async () => {
    // Both recommendations are already queued, so the ranked list is empty.
    api.getRecommended.mockResolvedValue({ tracks: [rec1] });
    setup({ queue: [seed, rec1], index: 1 });
    await waitFor(() => expect(logger.breadcrumb).toHaveBeenCalled());
    expect(usePlayerStore.getState().queue).toHaveLength(2);
  });

  it('logs a failed fetch and lets a later render retry', async () => {
    api.getRecommended.mockRejectedValueOnce(new Error('offline'));
    const { rerender } = setup();
    await waitFor(() => expect(logger.error).toHaveBeenCalled());
    expect(logger.error.mock.calls[0][1]).toBe('recommended fetch failed');
    // The guard is cleared in finally(), so the next render can try again.
    rerender({ ...base, queue: [seed] });
    await waitFor(() => expect(api.getRecommended).toHaveBeenCalledTimes(2));
  });
});
