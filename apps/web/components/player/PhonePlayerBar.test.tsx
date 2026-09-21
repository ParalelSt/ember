import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PHONE_BAR_SIZES,
  PhonePlayerBar,
  PLAYER_BAR_CHROME,
  type PhoneBarSize,
  type PhonePlayStyle,
} from './PhonePlayerBar';
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

// The px a size/type class draws, resolved the way the stylesheet does:
// `size-N` is N * 4px, `size-art-*` reads its --spacing-art-* token from
// globals.css, and the type scale is Tailwind's (xs 12, sm 14, base 16).
const GLOBALS = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');
function sizePx(cls: string): number {
  const token = cls.match(/(?:^|\s)size-(art-[a-z-]+)(?:\s|$)/);
  if (token) {
    const rem = GLOBALS.match(new RegExp(`--spacing-${token[1]}:\\s*([\\d.]+)rem;`));
    if (!rem) throw new Error(`no --spacing-${token[1]} in globals.css`);
    return Number(rem[1]) * 16;
  }
  const n = cls.match(/(?:^|\s)size-([\d.]+)(?:\s|$)/);
  if (!n) throw new Error(`no size-* in "${cls}"`);
  return Number(n[1]) * 4;
}
const FONT_PX: Record<string, number> = { 'text-xs': 12, 'text-sm': 14, 'text-base': 16 };
function fontPx(cls: string): number {
  const hit = Object.keys(FONT_PX).find((k) => cls.split(/\s+/).includes(k));
  if (!hit) throw new Error(`no type-scale class in "${cls}"`);
  return FONT_PX[hit];
}

function renderBar(size?: PhoneBarSize, playStyle?: PhonePlayStyle) {
  return render(
    <PhonePlayerBar
      track={TRACK}
      playing
      position={92}
      duration={264}
      onToggle={vi.fn()}
      onSeek={vi.fn()}
      onOpen={vi.fn()}
      size={size}
      playStyle={playStyle}
    />,
  );
}

function parts(container: HTMLElement) {
  const bar = within(container).getByTestId('phone-player-bar');
  const titleRow = within(bar).getByTestId('phone-player-title-row');
  const marquee = within(titleRow).getByTestId('marquee');
  return {
    bar,
    row: within(bar).getByTestId('phone-player-row'),
    art: titleRow.firstElementChild as HTMLElement,
    marquee,
    artist: marquee.nextElementSibling as HTMLElement,
    play: within(bar).getByRole('button', { name: 'Pause' }),
    disc: within(bar).queryByTestId('phone-play-disc'),
  };
}

describe('PhonePlayerBar size presets', () => {
  const SIZES = Object.keys(PHONE_BAR_SIZES) as PhoneBarSize[];

  it('offers the four presets, Today first', () => {
    expect(SIZES).toEqual(['today', 'balanced', 'art', 'compact']);
  });

  // The live app passes neither prop: it must render exactly the bar that
  // shipped before the presets existed, class for class.
  it('renders today exactly by default', () => {
    const { container } = renderBar();
    const p = parts(container);
    expect(p.bar.dataset).toMatchObject({ size: 'today', playStyle: 'disc' });
    expect(p.row.className).toBe('flex cursor-pointer items-center gap-block px-block pt-row pb-cluster');
    expect(p.art.className).toBe('relative overflow-hidden size-art-sm shrink-0 rounded-md bg-black');
    expect(p.marquee.className).toBe('relative overflow-hidden whitespace-nowrap text-sm font-semibold');
    expect(p.artist.className).toBe('truncate text-xs text-muted-foreground');
    // Today's button is the shared 48px PlayPauseButton: a solid white disc
    // that is its own hit box, with the 24px glyph inside.
    expect(box(p.play)).toEqual([48, 48]);
    expect(p.play).toHaveClass('shrink-0', 'rounded-full', 'bg-foreground', 'text-background');
    expect(p.disc).toBeNull();
    expect(p.play.querySelector('svg')).toHaveClass('size-6');
  });

  it('the explicit today + disc is the same markup as the default', () => {
    const a = renderBar().container.innerHTML;
    const b = renderBar('today', 'disc').container.innerHTML;
    expect(b).toBe(a);
  });

  for (const size of ['balanced', 'art', 'compact'] as const) {
    it(`${size}: artwork, type, row padding and a disc inside a larger hit box`, () => {
      const spec = PHONE_BAR_SIZES[size];
      const { container } = renderBar(size, 'disc');
      const p = parts(container);
      expect(p.bar.dataset).toMatchObject({ size, playStyle: 'disc' });
      expect(p.row.className).toBe(`flex cursor-pointer items-center gap-block px-block ${spec.row}`);
      expect(p.art).toHaveClass(...spec.art.split(' '));
      expect(p.marquee).toHaveClass(...spec.title.split(' '));
      expect(p.artist).toHaveClass(...spec.artist.split(' '), 'truncate', 'text-muted-foreground');
      expect(p.play).toHaveClass(...spec.hit.split(' '), 'shrink-0', 'rounded-full');
      expect(p.disc).not.toBeNull();
      expect(p.disc).toHaveClass(...spec.disc.split(' '), 'rounded-full', 'bg-foreground', 'text-background');
      expect(p.disc!.querySelector('svg')).toHaveClass(spec.discIcon);
    });
  }

  it('sizes each preset the way the brief asks', () => {
    const px = (size: PhoneBarSize) => {
      const s = PHONE_BAR_SIZES[size];
      return {
        art: sizePx(s.art),
        disc: sizePx(s.disc),
        hit: sizePx(s.hit),
        title: fontPx(s.title),
        artist: fontPx(s.artist),
      };
    };
    expect(px('today')).toEqual({ art: 48, disc: 48, hit: 48, title: 14, artist: 12 });
    expect(px('balanced')).toEqual({ art: 56, disc: 40, hit: 48, title: 16, artist: 14 });
    expect(px('art')).toEqual({ art: 64, disc: 44, hit: 48, title: 16, artist: 14 });
    expect(px('compact')).toEqual({ art: 48, disc: 40, hit: 48, title: 16, artist: 14 });
    for (const size of SIZES) {
      // Every tap target at least 44px; the disc never outgrows its hit box.
      expect(px(size).hit).toBeGreaterThanOrEqual(44);
      expect(px(size).disc).toBeLessThanOrEqual(px(size).hit);
    }
    // Compact's row is the shortest: less padding than today's pt-row.
    expect(PHONE_BAR_SIZES.compact.row).toBe('pt-cluster pb-inset');
  });

  for (const size of Object.keys(PHONE_BAR_SIZES) as PhoneBarSize[]) {
    it(`${size}: both play styles share one hit box`, () => {
      const disc = parts(renderBar(size, 'disc').container);
      const icon = parts(renderBar(size, 'icon').container);
      expect(sizePx(icon.play.className)).toBe(48);
      expect(sizePx(icon.play.className)).toBe(size === 'today' ? box(disc.play)[0] : sizePx(disc.play.className));
      // Icon only: no disc, the bare glyph in the text colour.
      expect(icon.disc).toBeNull();
      expect(icon.play).toHaveClass('text-foreground');
      expect(icon.play).not.toHaveClass('bg-foreground');
      expect(icon.play.querySelector('svg')).toHaveClass(PHONE_BAR_SIZES[size].bareIcon);
      expect(icon.bar.dataset.playStyle).toBe('icon');
    });
  }

  it('the presets keep the behaviour: play only plays, the row opens', () => {
    const onToggle = vi.fn();
    const onOpen = vi.fn();
    render(
      <PhonePlayerBar
        track={TRACK}
        playing={false}
        position={0}
        duration={264}
        onToggle={onToggle}
        onSeek={vi.fn()}
        onOpen={onOpen}
        size="balanced"
        playStyle="icon"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Play' }).querySelector('svg')!);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('phone-player-row'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
