import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueueSheet } from './QueueSheet';
import { usePlayerStore } from '@/stores/usePlayerStore';
import type { Track } from '@/types/track';

// The real Sheet renders through a base-ui Dialog portal, which pulls in a
// second React copy under vitest (see components/nav/Drawer.test.tsx); a
// plain div is all this test needs.
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SheetContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SheetHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SheetTitle: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));

const playTrack = vi.fn();
vi.mock('@/components/player/PlayerProvider', () => ({
  usePlayer: () => ({ playTrack }),
}));

function makeTrack(over: Partial<Track> = {}): Track {
  return {
    id: 'youtube:a1',
    source: 'youtube',
    sourceId: 'a1',
    title: 'Midnight Drive',
    artist: 'The Nulls',
    artistId: 'art1',
    album: 'Night Shift',
    albumId: 'alb1',
    durationSec: 191,
    artworkUrl: null,
    streamUrl: '',
    ...over,
  };
}

const current = makeTrack({ id: 'youtube:current', title: 'Now Playing Song' });
const next1 = makeTrack({ id: 'youtube:next1', title: 'Up Next One' });

beforeEach(() => {
  vi.clearAllMocks();
  usePlayerStore.setState({ queue: [current, next1], index: 0, context: null });
});

// O9: the upcoming rows only played on a click of the compact row itself, a
// mouse-only handler with no keyboard-reachable control.
describe('QueueSheet', () => {
  it('gives an upcoming row a keyboard-reachable play button', () => {
    render(<QueueSheet open onOpenChange={() => {}} />);

    const play = screen.getByRole('button', { name: `Play ${next1.title}` });
    fireEvent.click(play);
    expect(playTrack).toHaveBeenCalledWith(next1, [current, next1], null);
  });
});
