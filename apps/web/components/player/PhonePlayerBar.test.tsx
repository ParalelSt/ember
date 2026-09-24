import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
    onNext: vi.fn(),
    onOpen: vi.fn(),
  };
  const view = render(
    <PhonePlayerBar track={TRACK} playing position={92} duration={264} {...handlers} />,
  );
  return { ...view, ...handlers };
}

// The px a size/type class draws, resolved the way the stylesheet does:
// `size-N` is N * 4px, `size-art-*` reads its --spacing-art-* token from
// globals.css, and the type scale is Tailwind's (xs 12, sm 14, base 16).
// The live sizes are measured for real in tests/mobile-player-ui.test.mjs.
const GLOBALS = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');
function sizePx(el: Element): number {
  const cls = el.getAttribute('class') ?? '';
  const token = cls.match(/(?:^|\s)size-(art-[a-z-]+)(?:\s|$)/);
  if (token) {
    const rem = GLOBALS.match(new RegExp(`--spacing-${token[1]}:\\s*([\\d.]+)rem;`));
    if (!rem) throw new Error(`no --spacing-${token[1]} in globals.css`);
    return Number(rem[1]) * 16;
  }
  // The last size-N wins: tailwind-merge drops the Button variant's own.
  const all = [...cls.matchAll(/(?:^|\s)size-([\d.]+)(?=\s|$)/g)];
  if (!all.length) throw new Error(`no size-* in "${cls}"`);
  return Number(all[all.length - 1][1]) * 4;
}
const FONT_PX: Record<string, number> = { 'text-xs': 12, 'text-sm': 14, 'text-base': 16 };
function fontPx(el: Element): number {
  const cls = (el.getAttribute('class') ?? '').split(/\s+/);
  const hit = Object.keys(FONT_PX).filter((k) => cls.includes(k));
  if (hit.length !== 1) throw new Error(`want one type-scale class in "${cls.join(' ')}"`);
  return FONT_PX[hit[0]];
}

describe('PhonePlayerBar', () => {
  it('draws the artwork, the name, the artist and two controls: play/pause, then next', () => {
    const { container } = setup();
    const bar = screen.getByTestId('phone-player-bar');
    const titleRow = within(bar).getByTestId('phone-player-title-row');
    // The artwork sits beside the name, in one row, the old bar's shape.
    expect(titleRow.querySelector('.size-art-bar')).not.toBeNull();
    expect(titleRow).toHaveTextContent(TRACK.artist);
    expect(within(bar).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Open player', 'Pause', 'Next']);
    // Previous and the queue live on the full-screen view.
    for (const name of ['Previous', 'Queue']) {
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

  it('draws the Balanced sizes: artwork 56, name 16, artist 14', () => {
    setup();
    const titleRow = screen.getByTestId('phone-player-title-row');
    const art = titleRow.firstElementChild!;
    const marquee = within(titleRow).getByTestId('marquee');
    const artist = marquee.nextElementSibling!;
    expect(sizePx(art)).toBe(56);
    expect(art).toHaveClass('shrink-0', 'rounded-md');
    expect(fontPx(marquee)).toBe(16);
    expect(marquee).toHaveClass('font-semibold');
    expect(fontPx(artist)).toBe(14);
    expect(artist).toHaveClass('truncate', 'text-muted-foreground');
    expect(artist).toHaveTextContent(TRACK.artist);
    // No preset left to pick: the bar carries no size or style markers.
    const bar = screen.getByTestId('phone-player-bar');
    expect(bar.dataset.size).toBeUndefined();
    expect(bar.dataset.playStyle).toBeUndefined();
  });

  it('draws play as a 40px white disc inside a 48px hit box, glyph scaled to match', () => {
    setup();
    const play = screen.getByRole('button', { name: 'Pause' });
    expect(sizePx(play)).toBe(48);
    // Beside a flex-1 name column, it must never be squeezed.
    expect(play).toHaveClass('shrink-0', 'rounded-full');
    // The hit box itself paints nothing: the disc inside it is what shows.
    expect(play).not.toHaveClass('bg-foreground');
    const disc = within(play).getByTestId('phone-play-disc');
    expect(sizePx(disc)).toBe(40);
    expect(disc).toHaveClass('rounded-full', 'bg-foreground', 'text-background', 'items-center', 'justify-center');
    // Half the disc, the ratio the desktop disc uses.
    const glyph = disc.querySelector('svg')!;
    expect(sizePx(glyph)).toBe(20);
    expect(glyph).toHaveClass('fill-current');
    expect(within(play).getAllByTestId('phone-play-disc')).toHaveLength(1);
  });

  it('shows Play while paused', () => {
    render(
      <PhonePlayerBar track={TRACK} playing={false} position={0} duration={264} onToggle={vi.fn()} onSeek={vi.fn()} onNext={vi.fn()} onOpen={vi.fn()} />,
    );
    const play = screen.getByRole('button', { name: 'Play' });
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    // The play triangle keeps the disc and the glyph size, nudged one whole
    // pixel right so it reads centred.
    const glyph = within(play).getByTestId('phone-play-disc').querySelector('svg')!;
    expect(sizePx(glyph)).toBe(20);
    expect(glyph).toHaveClass('translate-x-px');
  });

  it('play toggles playback without opening the full-screen view', () => {
    const { onToggle, onOpen } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    // The disc and the icon inside the button are taps on the button too.
    fireEvent.click(screen.getByTestId('phone-play-disc'));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }).querySelector('svg')!);
    expect(onToggle).toHaveBeenCalledTimes(3);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('draws next as a plain 24px glyph in a 48px hit box, no disc', () => {
    setup();
    const next = screen.getByRole('button', { name: 'Next' });
    expect(sizePx(next)).toBe(48);
    expect(next).toHaveClass('shrink-0', 'rounded-full', 'text-foreground');
    expect(next).not.toHaveClass('bg-foreground');
    expect(within(next).queryByTestId('phone-play-disc')).toBeNull();
    const glyph = within(next).getByTestId('phone-next-glyph');
    expect(sizePx(glyph)).toBe(24);
    expect(glyph).toHaveClass('fill-current');
  });

  it('next skips without toggling or opening the full-screen view', () => {
    const { onNext, onToggle, onOpen } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByTestId('phone-next-glyph'));
    expect(onNext).toHaveBeenCalledTimes(2);
    expect(onToggle).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('a tap anywhere else on the row opens the full-screen view', () => {
    const { container, onOpen, onToggle } = setup();
    fireEvent.click(screen.getByTestId('phone-player-row'));
    fireEvent.click(container.querySelector('.size-art-bar')!);
    fireEvent.click(within(screen.getByTestId('phone-player-title-row')).getByText(TRACK.artist));
    fireEvent.click(within(screen.getByTestId('phone-player-title-row')).getByTestId('marquee'));
    // Once per tap: nothing inside opens it a second time on the way up.
    expect(onOpen).toHaveBeenCalledTimes(4);
    expect(onToggle).not.toHaveBeenCalled();
  });

  // O9: the title area used to be a plain div, reachable only by tapping it
  // with a mouse. A keyboard or screen-reader user had no way to open the
  // full-screen view at all (the outer row's onClick is a mouse-only div).
  it('makes the title area a real button labelled "Open player", reachable by keyboard', () => {
    const { onOpen } = setup();
    const titleButton = screen.getByRole('button', { name: 'Open player' });
    expect(titleButton).toBe(screen.getByTestId('phone-player-title-row'));
    expect(titleButton.tagName).toBe('BUTTON');

    titleButton.focus();
    expect(document.activeElement).toBe(titleButton);

    fireEvent.click(titleButton);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('lines the seek line up with the row: under the artwork on the left, under the next icon on the right', () => {
    setup();
    // Row: 16px on both sides, so next's 24px glyph, centred in its 48px
    // hit box, ends 28px in. The seek line runs 16px in on the left and 28px
    // on the right to match. The browser suite measures it for real.
    const row = screen.getByTestId('phone-player-row');
    expect(row).toHaveClass('pl-block', 'pr-block');
    const seekWrap = row.nextElementSibling!;
    expect(seekWrap).toHaveClass('pl-block', 'pr-[28px]');
  });

  it('leaves the strip chrome to the footer that holds it, with no safe-area lift of its own', () => {
    setup();
    // The bar itself paints nothing: the background and the top border are
    // one constant, spent by PlayerBar's <footer> and by the design
    // gallery's preview alike. The safe-area lift is NOT part of it: only
    // MobileNav, the bottom-most element in the shell, carries that, or the
    // bar would double up and leave an empty band under the seek line.
    const bar = screen.getByTestId('phone-player-bar');
    expect(bar.className).toBe('flex flex-col');
    expect(bar.getAttribute('style')).toBeNull();
    expect(PLAYER_BAR_CHROME.split(' ')).not.toContain('safe-area-bottom');
    expect(PLAYER_BAR_CHROME.split(' ')).toContain('bg-sidebar');
    expect(PLAYER_BAR_CHROME.split(' ')).toContain('border-t');
  });
});
