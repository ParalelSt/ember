import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PhonePlayerBar, PLAYER_BAR_CHROME } from './PhonePlayerBar';
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

function setup() {
  const handlers = {
    onToggle: vi.fn(),
    onSeek: vi.fn(),
    onOpen: vi.fn(),
  };
  const view = render(
    <PhonePlayerBar track={TRACK} playing position={92} duration={264} {...handlers} />,
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
  it('draws the artwork, the name, the artist and exactly one control: play/pause', () => {
    const { container } = setup();
    const bar = screen.getByTestId('phone-player-bar');
    const titleRow = within(bar).getByTestId('phone-player-title-row');
    // The artwork sits beside the name, in one row, the old bar's shape.
    expect(titleRow.querySelector('.size-art-sm')).not.toBeNull();
    expect(titleRow).toHaveTextContent(TRACK.artist);
    expect(within(bar).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Pause']);
    // Previous, next and the queue live on the full-screen view now.
    for (const name of ['Previous', 'Next', 'Queue']) {
      expect(within(bar).queryByRole('button', { name })).toBeNull();
    }
    // The seek line is still there, under the row.
    const row = within(bar).getByTestId('phone-player-row');
    const seek = within(bar).getByLabelText('progress');
    expect(row.compareDocumentPosition(seek) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.contains(seek)).toBe(false);
    expect(container.querySelectorAll('[data-testid="phone-player-controls-row"]')).toHaveLength(0);
  });

  it('scrolls the song name with the real MarqueeText', () => {
    setup();
    const marquee = within(screen.getByTestId('phone-player-title-row')).getByTestId('marquee');
    // MarqueeText draws an invisible ruler beside the title, so the name is
    // in there more than once. A copy of the component would not.
    expect(within(marquee).getAllByText(TRACK.title).length).toBeGreaterThan(0);
    expect(within(marquee).getByTestId('marquee-track')).toBeInTheDocument();
  });

  it('draws play at 48px and the artwork at 48px', () => {
    const { container } = setup();
    const play = screen.getByRole('button', { name: 'Pause' });
    expect(box(play)).toEqual([48, 48]);
    // Beside a flex-1 name column, it must never be squeezed.
    expect(play).toHaveClass('shrink-0', 'rounded-full');
    // --spacing-art-sm is 3rem, so `size-art-sm` is a 48px artwork box.
    expect(container.querySelector('.size-art-sm')).not.toBeNull();
  });

  it('shows Play while paused', () => {
    render(
      <PhonePlayerBar track={TRACK} playing={false} position={0} duration={264} onToggle={vi.fn()} onSeek={vi.fn()} onOpen={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  });

  it('play toggles playback without opening the full-screen view', () => {
    const { onToggle, onOpen } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    // The icon inside the button is a tap on the button too.
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }).querySelector('svg')!);
    expect(onToggle).toHaveBeenCalledTimes(2);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('a tap anywhere else on the row opens the full-screen view', () => {
    const { container, onOpen, onToggle } = setup();
    fireEvent.click(screen.getByTestId('phone-player-row'));
    fireEvent.click(container.querySelector('.size-art-sm')!);
    fireEvent.click(within(screen.getByTestId('phone-player-title-row')).getByText(TRACK.artist));
    fireEvent.click(within(screen.getByTestId('phone-player-title-row')).getByTestId('marquee'));
    // Once per tap: nothing inside opens it a second time on the way up.
    expect(onOpen).toHaveBeenCalledTimes(4);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('leaves the strip chrome, the safe-area lift included, to the footer that holds it', () => {
    setup();
    // The bar itself paints nothing: the background, the top border and the
    // safe-area stand-off are one constant, spent by PlayerBar's <footer>
    // and by the design gallery's preview alike.
    const bar = screen.getByTestId('phone-player-bar');
    expect(bar.className).toBe('flex flex-col');
    expect(bar.getAttribute('style')).toBeNull();
    // Not an env() string of its own: --safe-bottom lives once, on :root in
    // globals.css, and MobileNav spends the same class.
    expect(PLAYER_BAR_CHROME.split(' ')).toContain('safe-area-bottom');
    expect(PLAYER_BAR_CHROME.split(' ')).toContain('bg-sidebar');
    expect(PLAYER_BAR_CHROME.split(' ')).toContain('border-t');
  });
});
