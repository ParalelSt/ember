import type { ComponentProps, PropsWithChildren } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LyricsBody } from './LyricsBody';
import { NO_ANSWER_MESSAGE } from '@/lib/connectionBlip';
import { contrast } from '@/lib/theme/oklch';

// Synced lyrics, one line every 10 s: line N (1-based) is active from (N-1)*10.
const linesA = Array.from({ length: 10 }, (_, i) => ({ time: i * 10, text: `Line ${i + 1}` }));
const linesB = Array.from({ length: 10 }, (_, i) => ({ time: i * 10, text: `Other ${i + 1}` }));

const player = vi.hoisted(() => ({
  current: { id: 'a', title: 'Song A', artist: 'Artist' } as { id: string; title: string; artist: string },
  position: 25,
  seek: vi.fn(),
}));
const lyrics = vi.hoisted(() => ({ synced: [] as Array<{ time: number; text: string }> }));

vi.mock('@/components/player/PlayerProvider', () => ({ usePlayer: () => player, usePlayerPosition: () => player.position }));
vi.mock('@/hooks/useLyrics', () => ({
  useQueryLyrics: (track: { id: string } | null) => ({
    data: { lyrics: track?.id === 'b' ? 'B words' : 'x', synced: lyrics.synced, source: 'lrclib' },
    isLoading: false,
    error: null,
  }),
}));
const cover = vi.hoisted(() => ({ color: null as string | null, asked: [] as Array<string | null | undefined> }));
vi.mock('@/hooks/useCoverColor', () => ({
  useCoverColor: (url?: string | null) => {
    cover.asked.push(url);
    return cover.color;
  },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// base-ui pieces reach the root's hoisted React 18 (see RequestDialog.test.tsx).
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: PropsWithChildren<{ open: boolean }>) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogFooter: ({ children }: PropsWithChildren) => <div>{children}</div>,
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
  DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...rest }: ComponentProps<'button'>) => <button {...rest}>{children}</button>,
}));
vi.mock('@/components/ui/textarea', () => ({
  Textarea: (props: ComponentProps<'textarea'>) => <textarea {...props} />,
}));

let scrollTo: ReturnType<typeof vi.fn>;
const restore: Array<() => void> = [];

function stubProto<K extends keyof HTMLElement>(key: K, value: number) {
  const prev = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key);
  Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => value });
  restore.push(() => (prev ? Object.defineProperty(HTMLElement.prototype, key, prev) : delete (HTMLElement.prototype as never)[key]));
}

beforeEach(() => {
  player.current = { id: 'a', title: 'Song A', artist: 'Artist' };
  player.position = 25;
  player.seek.mockClear();
  lyrics.synced = linesA;
  cover.color = null;
  cover.asked = [];
  // No IntersectionObserver: the lyrics count as on screen right away.
  vi.stubGlobal('IntersectionObserver', undefined);
  scrollTo = vi.fn();
  const prevScrollTo = HTMLElement.prototype.scrollTo;
  HTMLElement.prototype.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
  restore.push(() => (HTMLElement.prototype.scrollTo = prevScrollTo));
  // Long enough to scroll: 2000px of lyrics in a 400px view.
  stubProto('clientHeight', 400);
  stubProto('scrollHeight', 2000);
});

afterEach(() => {
  while (restore.length) restore.pop()!();
  vi.unstubAllGlobals();
});

const scroller = () => screen.getByText('Line 1').closest('.overflow-y-auto') as HTMLElement;
const pill = () => screen.queryByRole('button', { name: /back to the current line/i });
const userScroll = () => act(() => { fireEvent.wheel(scroller(), { deltaY: 200 }); });

function renderBody() {
  const utils = render(<LyricsBody active />);
  const at = (position: number) => {
    player.position = position;
    utils.rerender(<LyricsBody active />);
  };
  return { ...utils, at };
}

describe('LyricsBody: follow mode', () => {
  it('follows the current line until the user scrolls, then shows the pill and stops auto-scrolling', () => {
    const { at } = renderBody();
    expect(pill()).toBeNull();
    at(35);
    expect(scrollTo).toHaveBeenCalled();

    userScroll();
    expect(pill()).toBeInTheDocument();
    expect(pill()).toHaveTextContent('Follow lyrics');
    expect(pill()?.getAttribute('data-direction')).toMatch(/^(up|down)$/);

    scrollTo.mockClear();
    at(45);
    at(55);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('the pill is tall: 12px across, 16px down', () => {
    renderBody();
    userScroll();
    expect(pill()).toHaveClass('px-row', 'py-block');
    expect(pill()).not.toHaveClass('px-block', 'py-row', 'py-cluster');
  });

  it('tapping the pill follows again and scrolls to the current line', () => {
    const { at } = renderBody();
    userScroll();
    scrollTo.mockClear();
    act(() => { fireEvent.click(pill()!); });
    expect(pill()).toBeNull();
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' }));
    scrollTo.mockClear();
    at(35);
    expect(scrollTo).toHaveBeenCalled();
  });

  it('tapping the pill never seeks, even if the same tap lands on a line as the pill goes', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      renderBody();
      userScroll();
      const p = pill()!;
      act(() => {
        fireEvent.pointerDown(p);
        fireEvent.click(p);
      });
      // The pill is gone and the finger's late click hits the line beneath it.
      act(() => { fireEvent.click(screen.getByText('Line 8')); });
      expect(player.seek).not.toHaveBeenCalled();

      // Well after the pill tap, lines seek again as usual.
      vi.advanceTimersByTime(1000);
      act(() => { fireEvent.click(screen.getByText('Line 8')); });
      expect(player.seek).toHaveBeenCalledWith(70);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the pill has a padded tap zone around it, so a near miss does not hit a line', () => {
    renderBody();
    userScroll();
    expect(pill()).toHaveClass('relative', 'before:absolute', 'before:-inset-3');
  });

  it('a big seek re-locks and lands on the new line', () => {
    const { at } = renderBody();
    userScroll();
    scrollTo.mockClear();
    at(75);
    expect(pill()).toBeNull();
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });

  it('a rewind into the intro re-locks and snaps back to the top', () => {
    const { at } = renderBody();
    at(45);
    userScroll();
    scrollTo.mockClear();
    lyrics.synced = linesA.map((l) => ({ ...l, time: l.time + 5 }));
    at(1);
    expect(pill()).toBeNull();
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
  });

  it('tapping a lyric line seeks there and re-locks', () => {
    renderBody();
    userScroll();
    act(() => { fireEvent.click(screen.getByText('Line 9')); });
    expect(player.seek).toHaveBeenCalledWith(80);
    expect(pill()).toBeNull();
  });

  it('a song change re-locks', () => {
    const { rerender } = renderBody();
    userScroll();
    expect(pill()).toBeInTheDocument();
    player.current = { id: 'b', title: 'Song B', artist: 'Artist' };
    lyrics.synced = linesB;
    rerender(<LyricsBody active />);
    expect(pill()).toBeNull();
  });

  it('a normal one-line advance does not count as a seek', () => {
    const { at } = renderBody();
    userScroll();
    at(35);
    expect(pill()).toBeInTheDocument();
  });
});

describe('LyricsBody: line states', () => {
  it('sung lines are dimmer than upcoming ones, and the current line stays bright', () => {
    renderBody(); // Position 25: line 3 is current.
    const sung = screen.getByText('Line 1').className;
    const current = screen.getByText('Line 3').className;
    const upcoming = screen.getByText('Line 4').className;
    expect(sung).toContain('dark:text-foreground/28');
    expect(sung).toContain('text-foreground/36');
    expect(sung).not.toContain('text-foreground/45');
    expect(upcoming).toContain('text-foreground/45');
    expect(upcoming).not.toContain('/28');
    expect(current.split(' ')).toContain('text-foreground');
    expect(current).not.toMatch(/text-foreground\/\d/);
  });

  it('before the first line nothing counts as sung', () => {
    const { at } = renderBody();
    at(-5);
    expect(screen.getByText('Line 1').className).toContain('text-foreground/45');
  });

  it('sung lines stay about as readable on a light theme as on a dark one', () => {
    const dark = contrast([0.98, 0, 0], [0.16, 0.005, 260], 0.28);
    const light = contrast([0.2, 0, 0], [0.97, 0, 0], 0.36);
    const lightUpcoming = contrast([0.2, 0, 0], [0.97, 0, 0], 0.45);
    expect(dark).toBeGreaterThan(2);
    expect(light).toBeGreaterThan(2);
    expect(Math.abs(light - dark)).toBeLessThan(0.5);
    expect(lightUpcoming).toBeGreaterThan(light);
  });
});

describe('LyricsBody: the report form', () => {
  it('reports the song it was opened on, even when the next song starts while it is open', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<LyricsBody active />);
    fireEvent.click(screen.getByRole('button', { name: 'Report incorrect lyrics' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'The chorus is wrong' } });

    // Song A ends and song B starts while the listener is still typing.
    player.current = { id: 'b', title: 'Song B', artist: 'Other' };
    rerender(<LyricsBody active />);
    expect(screen.getByText(/Song A/, { selector: 'p' })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body);
    expect(body).toMatchObject({ trackTitle: 'Song A', trackArtist: 'Artist', lyrics: 'x', note: 'The chorus is wrong' });
  });

  it('a Wi-Fi sign-in page answering 200 is not "Report sent": the note stays and it says so', async () => {
    const { toast } = await import('sonner');
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<!DOCTYPE html><p>Sign in</p>', { status: 200, headers: { 'content-type': 'text/html' } })));
    render(<LyricsBody active />);
    fireEvent.click(screen.getByRole('button', { name: 'Report incorrect lyrics' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'The chorus is wrong' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    });

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(`Couldn't send: ${NO_ANSWER_MESSAGE}`);
    expect(screen.getByRole('textbox')).toHaveValue('The chorus is wrong');
  });
});

describe('LyricsBody: colour backdrop', () => {
  const backdrop = () => screen.getByTestId('lyrics-backdrop');

  it('paints the colour of the song\'s cover', () => {
    cover.color = 'rgb(100, 25, 50)';
    player.current = { id: 'a', title: 'Song A', artist: 'Artist', artworkUrl: 'https://i.ytimg.com/a.jpg' } as typeof player.current;
    renderBody();
    expect(cover.asked.at(-1)).toBe('https://i.ytimg.com/a.jpg');
    expect(backdrop()).toHaveClass('lyrics-backdrop');
    expect(backdrop().style.getPropertyValue('--lyrics-cover')).toBe('rgb(100, 25, 50)');
  });

  it('with no colour to read, sets none: the plain background shows', () => {
    renderBody();
    expect(backdrop().style.getPropertyValue('--lyrics-cover')).toBe('');
  });

  it('does not read the cover while nobody can see the lyrics', () => {
    player.current = { id: 'a', title: 'Song A', artist: 'Artist', artworkUrl: 'https://i.ytimg.com/a.jpg' } as typeof player.current;
    render(<LyricsBody active={false} />);
    expect(cover.asked.at(-1)).toBeNull();
  });

  it('the gradient runs fully into the background, fades between songs, and holds still under reduced motion', () => {
    const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');
    expect(css).toContain('linear-gradient(170deg, var(--lyrics-cover), var(--background) 75%)');
    expect(css).toMatch(/@property --lyrics-cover \{\s*syntax: '<color>';/);
    expect(css).toContain('transition: --lyrics-cover 700ms ease-out');
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.lyrics-backdrop \{ transition: none; \}/);
    // Dark themes only: a light theme's words are dark.
    expect(css).toContain('.dark .lyrics-backdrop');
  });

  it('has no borders on the header, the song row or the report row', () => {
    const { container } = render(<LyricsBody active onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Close lyrics' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Report incorrect lyrics' })).toBeInTheDocument();
    expect(container.querySelector('[class*="border-"]')).toBeNull();
  });

  it('lines are big and bold, the current one solid and the rest dimmed', () => {
    renderBody();
    const line = (name: string) => screen.getByRole('button', { name });
    for (const name of ['Line 1', 'Line 3', 'Line 4']) expect(line(name)).toHaveClass('text-xl', 'font-bold');
    expect(line('Line 3')).toHaveClass('text-foreground');
    expect(line('Line 4')).toHaveClass('text-foreground/45');
    expect(line('Line 1')).toHaveClass('dark:text-foreground/28');
  });

  it('tapping a line still seeks to it', () => {
    renderBody();
    fireEvent.click(screen.getByRole('button', { name: 'Line 7' }));
    expect(player.seek).toHaveBeenCalledWith(60);
  });

  it('plain lyrics are big and bold too', () => {
    lyrics.synced = [];
    render(<LyricsBody active />);
    expect(screen.getByText('x')).toHaveClass('text-xl', 'font-bold', 'text-foreground');
  });
});
