import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRef } from 'react';
import { RELOCK_IDLE_MS, useLyricsFollow } from './useLyricsFollow';

// The scroller is 400px tall and shows y 0..400 of a 2000px list. Each line's
// on-screen top is stubbed per test via `lineTop`, so "where is the active
// line" is fully under the test's control (happy-dom does no layout).
const VIEW = 400;
let scroller: HTMLDivElement;
let lines: HTMLDivElement[];
let lineTop: number[];
let scrollTo: ReturnType<typeof vi.fn>;

function rect(top: number, height: number): DOMRect {
  return { top, bottom: top + height, height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
}

beforeEach(() => {
  vi.useFakeTimers();
  scroller = document.createElement('div');
  Object.defineProperty(scroller, 'clientHeight', { configurable: true, value: VIEW });
  Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: 2000 });
  scroller.getBoundingClientRect = () => rect(0, VIEW);
  scrollTo = vi.fn();
  scroller.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
  lineTop = [];
  lines = Array.from({ length: 10 }, (_, i) => {
    const el = document.createElement('div');
    Object.defineProperty(el, 'clientHeight', { configurable: true, value: 20 });
    el.getBoundingClientRect = () => rect(lineTop[i] ?? i * 40, 20);
    scroller.appendChild(el);
    return el;
  });
  document.body.appendChild(scroller);
});

afterEach(() => {
  scroller.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(initial: { activeIdx: number; resetKey?: unknown } = { activeIdx: 2 }) {
  return renderHook(
    ({ activeIdx, resetKey }: { activeIdx: number; resetKey?: unknown }) => {
      const scrollerRef = useRef<HTMLDivElement | null>(scroller);
      const lineRefs = useRef<Array<HTMLElement | null>>(lines);
      return useLyricsFollow({ scrollerRef, lineRefs, activeIdx, resetKey });
    },
    { initialProps: { resetKey: 'song-a', ...initial } },
  );
}

const wheel = () => act(() => { scroller.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true })); });
const scrollEvt = () => act(() => { scroller.dispatchEvent(new Event('scroll')); });
const touch = (type: 'touchstart' | 'touchmove' | 'touchend') =>
  act(() => { scroller.dispatchEvent(new Event(type, { bubbles: true })); });
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

describe('useLyricsFollow: turning following off', () => {
  it('follows by default and a user wheel turns it off', () => {
    const { result } = setup();
    expect(result.current.following).toBe(true);
    wheel();
    expect(result.current.following).toBe(false);
  });

  it('a programmatic scroll (scroll event with no user input) does not', () => {
    const { result } = setup();
    scrollEvt();
    scrollEvt();
    expect(result.current.following).toBe(true);
  });

  it('a touch drag turns it off, a bare touchstart does not', () => {
    const { result } = setup();
    touch('touchstart');
    expect(result.current.following).toBe(true);
    touch('touchmove');
    expect(result.current.following).toBe(false);
  });

  it('scroll keys turn it off, other keys do not', () => {
    const { result } = setup();
    act(() => { scroller.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true })); });
    expect(result.current.following).toBe(true);
    act(() => { scroller.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true })); });
    expect(result.current.following).toBe(false);
  });

  it('a pointerdown on the scroller itself (its scrollbar) turns it off, on a line it does not', () => {
    const { result } = setup();
    act(() => { lines[3].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })); });
    expect(result.current.following).toBe(true);
    act(() => { scroller.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' })); });
    expect(result.current.following).toBe(false);
  });

  it('a wheel over lyrics too short to scroll changes nothing', () => {
    Object.defineProperty(scroller, 'scrollHeight', { configurable: true, value: VIEW });
    const { result } = setup();
    wheel();
    expect(result.current.following).toBe(true);
  });
});

describe('useLyricsFollow: pill direction', () => {
  it('points down when the current line is below the view, up when above', () => {
    lineTop[2] = 900;
    const { result } = setup();
    wheel();
    expect(result.current.direction).toBe('down');
    lineTop[2] = -300;
    scrollEvt();
    expect(result.current.direction).toBe('up');
  });
});

describe('useLyricsFollow: tapping the pill', () => {
  it('turns following on and smooth-scrolls the current line to the center', () => {
    lineTop[2] = 900;
    const { result } = setup();
    wheel();
    act(() => result.current.resume());
    expect(result.current.following).toBe(true);
    // line top 900 + half its height 10 - half the view 200 = 710 below scrollTop 0
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 710, behavior: 'smooth' });
  });

  it("uses 'auto' when the user prefers reduced motion", () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), media: q }));
    lineTop[2] = 900;
    const { result } = setup();
    wheel();
    act(() => result.current.resume());
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 710, behavior: 'auto' });
    expect(result.current.behavior(true)).toBe('auto');
  });
});

describe('useLyricsFollow: smart re-lock', () => {
  it('re-locks after 3 s idle when the current line is in the middle band', () => {
    lineTop[2] = 190; // center 200 of 400: dead middle
    const { result } = setup();
    wheel();
    wait(RELOCK_IDLE_MS - 1);
    expect(result.current.following).toBe(false);
    wait(1);
    expect(result.current.following).toBe(true);
  });

  it('keeps waiting while user input continues', () => {
    lineTop[2] = 190;
    const { result } = setup();
    wheel();
    wait(2000);
    wheel();
    wait(2000);
    expect(result.current.following).toBe(false);
    wait(1000);
    expect(result.current.following).toBe(true);
  });

  it('does not re-lock while the current line sits outside the middle 60%', () => {
    lineTop[2] = 30; // center 40: in the top 20%
    const { result } = setup();
    wheel();
    wait(10_000);
    expect(result.current.following).toBe(false);
  });

  it('re-locks once the song carries the current line into the middle band after the idle time', () => {
    lineTop[3] = 900;
    const { result, rerender } = setup({ activeIdx: 3 });
    wheel();
    wait(5000);
    expect(result.current.following).toBe(false);
    lineTop[4] = 200;
    rerender({ activeIdx: 4, resetKey: 'song-a' });
    expect(result.current.following).toBe(true);
  });

  it('never re-locks while a finger is down', () => {
    lineTop[2] = 190;
    const { result } = setup();
    touch('touchstart');
    touch('touchmove');
    wait(10_000);
    expect(result.current.following).toBe(false);
    touch('touchend');
    wait(RELOCK_IDLE_MS);
    expect(result.current.following).toBe(true);
  });

  it('a momentum scroll after the finger lifts still counts as user input', () => {
    lineTop[2] = 190;
    const { result } = setup();
    touch('touchstart');
    touch('touchmove');
    touch('touchend');
    wait(2500);
    scrollEvt();
    wait(2500);
    expect(result.current.following).toBe(false);
    wait(500);
    expect(result.current.following).toBe(true);
  });
});

describe('useLyricsFollow: explicit re-locks', () => {
  it('relock() (line tap, big seek) turns following on without scrolling', () => {
    lineTop[2] = 900;
    const { result } = setup();
    wheel();
    act(() => result.current.relock());
    expect(result.current.following).toBe(true);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('a song change turns following back on', () => {
    lineTop[2] = 900;
    const { result, rerender } = setup();
    wheel();
    rerender({ activeIdx: 2, resetKey: 'song-b' });
    expect(result.current.following).toBe(true);
  });

  it('followingRef mirrors the state for effects that read it synchronously', () => {
    const { result } = setup();
    wheel();
    expect(result.current.followingRef.current).toBe(false);
    act(() => result.current.relock());
    expect(result.current.followingRef.current).toBe(true);
  });
});
