import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PhonePlayerBar } from './PhonePlayerBar';
import type { Track } from '@/types/track';

// base-ui's Slider reaches the repo root's hoisted React 18 through its own
// copy, so it cannot render under happy-dom (see SeekBar.test.tsx, which
// covers the real seek behaviour). The bar only needs it to be *there*.
vi.mock('@/components/ui/slider', () => ({
  Slider: ({ className }: { className?: string }) => (
    <input type="range" aria-label="progress" className={className} readOnly />
  ),
}));

const TRACK: Track = {
  id: 't1',
  source: 'youtube',
  sourceId: 'v1',
  title: 'Yes Sir, I Can Boogie',
  artist: 'Baccara',
  artistId: 'a1',
  album: 'Baccara',
  albumId: 'al1',
  durationSec: 264,
  artworkUrl: 'https://example.test/art.jpg',
  streamUrl: 'https://example.test/s.mp3',
};

function setup(props: Partial<Parameters<typeof PhonePlayerBar>[0]> = {}) {
  const handlers = {
    onToggle: vi.fn(),
    onNext: vi.fn(),
    onPrev: vi.fn(),
    onSeek: vi.fn(),
    onOpen: vi.fn(),
    onQueue: vi.fn(),
  };
  const view = render(
    <PhonePlayerBar track={TRACK} playing position={92} duration={264} {...handlers} {...props} />,
  );
  return { ...view, ...handlers };
}

/** The tap box a control actually draws, in px, from its h-/w- pair. The
 *  Button variant also leaves a `size-8` in the class string; tailwind-merge
 *  keeps both, and the h-/w- utilities are emitted after `size-*` in the
 *  stylesheet, so they are the ones that win. The live sizes are measured
 *  for real in tests/mobile-player-ui.test.mjs. */
function box(el: HTMLElement): [number, number] {
  const h = el.className.match(/(?:^|\s)h-(\d+)(?:\s|$)/);
  const w = el.className.match(/(?:^|\s)w-(\d+)(?:\s|$)/);
  return [h ? Number(h[1]) * 4 : 0, w ? Number(w[1]) * 4 : 0];
}

describe('PhonePlayerBar', () => {
  it('puts the song name on its own row above the controls', () => {
    setup();
    const bar = screen.getByTestId('phone-player-bar');
    const titleRow = within(bar).getByTestId('phone-player-title-row');
    const controlsRow = within(bar).getByTestId('phone-player-controls-row');

    // Two rows, name first: the whole point of the layout.
    expect(titleRow.compareDocumentPosition(controlsRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The name row holds the name and nothing else, so it has the full width.
    expect(within(titleRow).queryByRole('button')).toBeNull();
    expect(titleRow).toHaveTextContent(TRACK.artist);
    // Every control is in the second row.
    for (const name of ['Previous', 'Pause', 'Next', 'Queue']) {
      expect(within(controlsRow).getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('scrolls the song name with the real MarqueeText', () => {
    setup();
    const marquee = within(screen.getByTestId('phone-player-title-row')).getByTestId('marquee');
    // MarqueeText draws an invisible ruler beside the title, so the name is
    // in there more than once. A copy of the component would not.
    expect(within(marquee).getAllByText(TRACK.title).length).toBeGreaterThan(0);
    expect(within(marquee).getByTestId('marquee-track')).toBeInTheDocument();
  });

  it('draws the approved tap sizes: play 56, prev/next 48, queue 48, artwork 48', () => {
    const { container } = setup();
    expect(box(screen.getByRole('button', { name: 'Pause' }))).toEqual([56, 56]);
    expect(box(screen.getByRole('button', { name: 'Previous' }))).toEqual([48, 48]);
    expect(box(screen.getByRole('button', { name: 'Next' }))).toEqual([48, 48]);
    expect(box(screen.getByRole('button', { name: 'Queue' }))).toEqual([48, 48]);
    // --spacing-art-sm is 3rem, so `size-art-sm` is a 48px artwork box.
    expect(container.querySelector('.size-art-sm')).not.toBeNull();
  });

  it('fires every control, and the name and the artwork open the full-screen view', () => {
    const { container, onToggle, onNext, onPrev, onQueue, onOpen } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    fireEvent.click(screen.getByRole('button', { name: 'Queue' }));
    expect([onToggle, onNext, onPrev, onQueue].map((f) => f.mock.calls.length)).toEqual([1, 1, 1, 1]);

    fireEvent.click(screen.getByTestId('phone-player-title-row'));
    fireEvent.click(container.querySelector('.size-art-sm')!);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('stands off the bottom edge through the one shared safe-area class', () => {
    setup();
    // Not an env() string of its own: the value lives once, on :root in
    // globals.css, and MobileNav spends the same class.
    expect(screen.getByTestId('phone-player-bar')).toHaveClass('safe-area-bottom');
    expect(screen.getByTestId('phone-player-bar').getAttribute('style')).toBeNull();
  });

  it('takes its breakpoint gate from the caller, so a 390px preview can show it', () => {
    setup({ className: 'md:hidden' });
    expect(screen.getByTestId('phone-player-bar')).toHaveClass('md:hidden');
  });
});
