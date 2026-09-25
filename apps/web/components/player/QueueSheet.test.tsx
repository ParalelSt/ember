/** A tap on an "up next" song jumps to that entry of the queue (bughunt
 *  2026-09-25 P9). It used to start a new queue from the old one with
 *  playTrack: a search-started queue collapsed to the tapped song, shuffle
 *  turned itself off, and the loop point moved into the radio tail. */
import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueueSheet } from './QueueSheet';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { makeTrack } from '@/test-utils/fakeBackend';

const player = vi.hoisted(() => ({ playAt: vi.fn(), playTrack: vi.fn() }));
vi.mock('@/components/player/PlayerProvider', () => ({ usePlayer: () => player }));
vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SheetContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SheetHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SheetTitle: ({ children }: PropsWithChildren) => <div>{children}</div>,
}));
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ push: vi.fn() }) }));

describe('QueueSheet', () => {
  it('jumps to the tapped entry instead of starting a new queue', () => {
    const a = makeTrack({ id: 'youtube:a', title: 'Alpha' });
    const b = makeTrack({ id: 'youtube:b', title: 'Bravo' });
    const c = makeTrack({ id: 'youtube:c', title: 'Charlie' });
    usePlayerStore.setState({ queue: [a, b, a, c], index: 1, context: { type: 'search', query: 'q' } as never });
    render(<QueueSheet open onOpenChange={() => {}} />);
    // The upcoming "Alpha" is queue entry 2; a lookup by id finds entry 0.
    fireEvent.click(screen.getByText('Alpha'));
    expect(player.playAt).toHaveBeenCalledWith(2);
    expect(player.playTrack).not.toHaveBeenCalled();
  });
});
