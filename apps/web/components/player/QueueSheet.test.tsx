/** A tap on an "up next" song jumps to that entry of the queue (bughunt
 *  2026-09-25 P9). It used to start a new queue from the old one with
 *  playTrack: a search-started queue collapsed to the tapped song, shuffle
 *  turned itself off, and the loop point moved into the radio tail. */
import type { PropsWithChildren } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueueSheet } from './QueueSheet';
import { usePlayerStore } from '@/stores/usePlayerStore';
import { clearCouldntPlay, recordCouldntPlay, resetUnplayableStore } from '@/stores/useUnplayableStore';
import type { UnplayableNotice } from '@/lib/playback/unplayable';
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

afterEach(() => resetUnplayableStore());

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

  it('keeps a song that could not play in the queue, greyed, with the UNAVAILABLE pill', () => {
    const a = makeTrack({ id: 'youtube:a', title: 'Alpha' });
    const gone = makeTrack({ id: 'youtube:g', title: 'Gone Song', unavailableAt: '2026-09-30T10:00:00Z', unavailableReason: 'removed' });
    const c = makeTrack({ id: 'youtube:c', title: 'Charlie' });
    usePlayerStore.setState({ queue: [a, gone, c], index: 0, context: null });
    render(<QueueSheet open onOpenChange={() => {}} />);
    const row = screen.getByText('Gone Song').closest('[data-unavailable]');
    expect(row).toHaveAttribute('data-unavailable', 'true');
    expect(row).toHaveClass('opacity-60');
    const pill = within(row as HTMLElement).getByTestId('unavailable-badge');
    expect(pill).toHaveTextContent('Unavailable');
    // The reason is the pill's tooltip.
    expect(pill).toHaveAttribute('title', 'Removed from YouTube');
    // A tap explains instead of jumping.
    player.playAt.mockClear();
    fireEvent.click(screen.getByText('Gone Song'));
    expect(player.playAt).not.toHaveBeenCalled();
    expect(screen.getByText('Charlie').closest('[data-unavailable]')).toBeNull();
  });
});

describe('QueueSheet: "Couldn\'t play" (songs this session skipped)', () => {
  const skipped = (t: { id: string; title: string }, reason: string | null, over: Partial<UnplayableNotice> = {}): UnplayableNotice => ({
    trackId: t.id, title: t.title, kind: 'unavailable', reason, outcome: 'skipped', ...over,
  });
  const field = makeTrack({ id: 'youtube:f', title: 'Field Day', unavailableAt: '2026-10-01T10:00:00Z', unavailableReason: 'removed' });
  const night = makeTrack({ id: 'youtube:n', title: 'Night Swim', unavailableAt: '2026-10-01T10:00:00Z', unavailableReason: 'private' });
  const paper = makeTrack({ id: 'youtube:p', title: 'Paper Planes', unavailableAt: '2026-10-01T10:00:00Z', unavailableReason: 'geo' });
  const glass = makeTrack({ id: 'youtube:g', title: 'Glass Coast' });
  const north = makeTrack({ id: 'youtube:x', title: 'Northbound' });

  it('lists them above Now playing with the reason and "Skipped", as in the owner\'s pick', () => {
    usePlayerStore.setState({ queue: [field, night, paper, glass, north], index: 3, context: null });
    recordCouldntPlay([skipped(field, 'removed'), skipped(night, 'private'), skipped(paper, 'geo')]);
    render(<QueueSheet open onOpenChange={() => {}} />);

    const section = screen.getByTestId('couldnt-play');
    expect(section).toHaveTextContent("Couldn't play · 3");
    const rows = within(section).getAllByTestId('couldnt-play-row');
    expect(rows.map((r) => r.textContent)).toEqual([
      'Field DayRemoved from YouTube · Skipped',
      'Night SwimMade private · Skipped',
      'Paper PlanesBlocked in this country · Skipped',
    ]);
    // Above "Now playing", which is above "Next up".
    const text = document.body.textContent ?? '';
    expect(text.indexOf("Couldn't play")).toBeLessThan(text.indexOf('Now playing'));
    expect(text.indexOf('Now playing')).toBeLessThan(text.indexOf('Next up'));
    // The rows are greyed (the artwork faded, grey).
    expect(rows[0].querySelector('.grayscale')).not.toBeNull();
  });

  it('an age-restricted song reads "Age-restricted on YouTube", in the list and on its pill', () => {
    const aged = makeTrack({ id: 'youtube:JuXvuM-xn5M', title: 'Age Gated', unavailableAt: '2026-10-03T10:35:00Z', unavailableReason: 'age' });
    usePlayerStore.setState({ queue: [aged, glass, aged], index: 1, context: null });
    recordCouldntPlay([skipped(aged, 'age')]);
    render(<QueueSheet open onOpenChange={() => {}} />);
    const section = screen.getByTestId('couldnt-play');
    expect(within(section).getAllByTestId('couldnt-play-row').map((r) => r.textContent)).toEqual([
      'Age GatedAge-restricted on YouTube · Skipped',
    ]);
    // The same song still ahead in the queue: greyed, the reason on its pill.
    const pills = screen.getAllByTestId('unavailable-badge');
    expect(pills.length).toBeGreaterThan(0);
    for (const pill of pills) expect(pill).toHaveAttribute('title', 'Age-restricted on YouTube');
  });

  it('a song whose reason the host did not give says "Not available on YouTube"; one that would not load says so', () => {
    const odd = makeTrack({ id: 'youtube:o', title: 'Odd One' });
    const flaky = makeTrack({ id: 'youtube:k', title: 'Flaky' });
    usePlayerStore.setState({ queue: [odd, flaky, glass], index: 2, context: null });
    recordCouldntPlay([skipped(odd, null), skipped(flaky, null, { kind: 'transient' })]);
    render(<QueueSheet open onOpenChange={() => {}} />);
    const notes = screen.getAllByTestId('couldnt-play-note').map((n) => n.textContent);
    expect(notes).toEqual(['Not available on YouTube · Skipped', "Couldn't load right now · Skipped"]);
  });

  it('leaves out the song playing (it has its own row) and songs no longer in the queue', () => {
    usePlayerStore.setState({ queue: [field, glass], index: 0, context: null });
    recordCouldntPlay([skipped(field, 'removed', { outcome: 'gave-up' }), skipped(night, 'private')]);
    render(<QueueSheet open onOpenChange={() => {}} />);
    expect(screen.queryByTestId('couldnt-play')).toBeNull();
  });

  it('is gone once the list is cleared (a new queue)', () => {
    usePlayerStore.setState({ queue: [field, glass], index: 1, context: null });
    recordCouldntPlay([skipped(field, 'removed')]);
    const view = render(<QueueSheet open onOpenChange={() => {}} />);
    expect(screen.getByTestId('couldnt-play')).toBeInTheDocument();
    clearCouldntPlay();
    view.rerender(<QueueSheet open onOpenChange={() => {}} />);
    expect(screen.queryByTestId('couldnt-play')).toBeNull();
  });
});
