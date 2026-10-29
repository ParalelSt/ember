/** The queue sheet lives inside the player bar and the full-screen player,
 *  which re-render on every playhead report to move their seek bars. An open
 *  queue of a few thousand songs (a Liked list) was rebuilt row by row each
 *  time; only its progress line follows the position. */
import type { PropsWithChildren } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueueSheet } from './QueueSheet';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { makeTrack } from '@/test-utils/fakeBackend';

const player = vi.hoisted(() => ({ playAt: vi.fn(), playTrack: vi.fn(), playBack: vi.fn() }));
vi.mock('@/components/player/PlayerProvider', () => ({ usePlayer: () => player }));
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SheetContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SheetHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SheetTitle: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('@/hooks/useIsDesktop', () => ({ useIsDesktop: () => true }));
const rowRendered = vi.hoisted(() => vi.fn());
vi.mock('@/components/track/TrackRow', () => ({
  TrackRow: ({ track }: { track: { title: string } }) => {
    rowRendered();
    return <div>{track.title}</div>;
  },
}));

const noop = () => {};

/** Stands in for the player bar: shows the playhead, holds the sheet. */
function Bar() {
  const position = usePlayerStore((s) => s.position);
  return (
    <>
      <span data-testid="clock">{position}</span>
      <QueueSheet open onOpenChange={noop} />
    </>
  );
}

beforeEach(() => {
  rowRendered.mockClear();
  const queue = Array.from({ length: 50 }, (_, i) => makeTrack({ id: `youtube:${i}`, title: `Song ${i}` }));
  usePlayerStore.setState({ queue, index: 0, played: [], position: 0, duration: 200 });
});

describe('QueueSheet on playhead reports', () => {
  it('does not re-render its rows when only the position moves', () => {
    render(<Bar />);
    const rows = rowRendered.mock.calls.length;
    expect(rows).toBe(50);
    for (let s = 1; s <= 5; s += 0.25) act(() => usePlayerStore.getState().setPosition(s));
    expect(screen.getByTestId('clock')).toHaveTextContent('5');
    expect(rowRendered).toHaveBeenCalledTimes(rows);
  });
});
