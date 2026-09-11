import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDiscordPresence } from './useDiscordPresence';
import { makeTrack } from '@/test-utils/fakeBackend';

const presence = vi.hoisted(() => ({ publishDiscordPresence: vi.fn() }));
vi.mock('@/lib/discordPresence', () => presence);

const a = makeTrack();
const b = makeTrack({ id: 'youtube:b2', sourceId: 'b2', title: 'Second Song' });

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
    rerender({ current: b, isPlaying: true, position: 0, duration: 240 });
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(2);
    expect(presence.publishDiscordPresence).toHaveBeenLastCalledWith(b, true, 0, 240);
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
});
