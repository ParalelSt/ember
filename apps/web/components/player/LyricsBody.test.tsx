import type { ComponentProps, PropsWithChildren } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { LyricsBody } from './LyricsBody';

// Synced lyrics, one line every 10 s: line N (1-based) is active from (N-1)*10.
const linesA = Array.from({ length: 10 }, (_, i) => ({ time: i * 10, text: `Line ${i + 1}` }));
const linesB = Array.from({ length: 10 }, (_, i) => ({ time: i * 10, text: `Other ${i + 1}` }));

const player = vi.hoisted(() => ({
  current: { id: 'a', title: 'Song A', artist: 'Artist' } as { id: string; title: string; artist: string },
  position: 25,
  seek: vi.fn(),
}));
const lyrics = vi.hoisted(() => ({ synced: [] as Array<{ time: number; text: string }> }));

vi.mock('@/components/player/PlayerProvider', () => ({ usePlayer: () => player }));
vi.mock('@/hooks/useLyrics', () => ({
  useQueryLyrics: () => ({ data: { lyrics: 'x', synced: lyrics.synced, source: 'lrclib' }, isLoading: false, error: null }),
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
