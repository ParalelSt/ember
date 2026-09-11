import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDiscordPresence } from './useDiscordPresence';
import { makeTrack } from './fakeBackend';

const presence = vi.hoisted(() => ({ publishDiscordPresence: vi.fn() }));
vi.mock('@/lib/discordPresence', () => presence);

const a = makeTrack();
const b = makeTrack({ id: 'youtube:b2', sourceId: 'b2', title: 'Second Song' });

function setup(current = a, isPlaying = true) {
  return renderHook(
    ({ current, isPlaying }: { current: typeof a | null; isPlaying: boolean }) =>
      useDiscordPresence({ current, isPlaying }),
    { initialProps: { current: current as typeof a | null, isPlaying } },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useDiscordPresence', () => {
  it('publishes the current track on mount', () => {
    setup();
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(1);
    expect(presence.publishDiscordPresence).toHaveBeenCalledWith(a, true);
  });

  it('publishes again when the track changes', () => {
    const { rerender } = setup();
    rerender({ current: b, isPlaying: true });
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(2);
    expect(presence.publishDiscordPresence).toHaveBeenLastCalledWith(b, true);
  });

  it('publishes again when playback pauses or resumes', () => {
    const { rerender } = setup();
    rerender({ current: a, isPlaying: false });
    expect(presence.publishDiscordPresence).toHaveBeenLastCalledWith(a, false);
    rerender({ current: a, isPlaying: true });
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(3);
  });

  it('does not republish on a position tick', () => {
    // The provider re-renders on every timeupdate; a new object for the SAME
    // song must not reach Discord.
    const { rerender } = setup();
    rerender({ current: { ...a }, isPlaying: true });
    rerender({ current: { ...a }, isPlaying: true });
    expect(presence.publishDiscordPresence).toHaveBeenCalledTimes(1);
  });

  it('publishes a cleared presence when the queue empties', () => {
    const { rerender } = setup();
    rerender({ current: null, isPlaying: false });
    expect(presence.publishDiscordPresence).toHaveBeenLastCalledWith(null, false);
  });
});
