import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SWIPE_MIN_PX, swipeDirection, useSwipeSkip } from './useSwipeSkip';

/** Swipe the cover to skip, on a car head unit: left is next, right is
 *  previous; short or mostly up-and-down drags are not swipes. */

describe('swipeDirection', () => {
  it('left is the next song, right the one before', () => {
    expect(swipeDirection(-SWIPE_MIN_PX, 0)).toBe('next');
    expect(swipeDirection(SWIPE_MIN_PX + 20, 10)).toBe('prev');
  });

  it('a short drag, or one that is mostly up and down, is not a swipe', () => {
    expect(swipeDirection(-(SWIPE_MIN_PX - 1), 0)).toBeNull();
    expect(swipeDirection(-60, 50)).toBeNull();
    expect(swipeDirection(0, 200)).toBeNull();
  });
});

function Cover({ enabled, onNext, onPrev, onOpen }: { enabled: boolean; onNext: () => void; onPrev: () => void; onOpen: () => void }) {
  const swipe = useSwipeSkip({ onNext, onPrev, enabled });
  return (
    <div data-testid="cover" {...swipe}>
      <a href="#song" onClick={onOpen}>Song</a>
    </div>
  );
}

function drag(el: HTMLElement, dx: number, dy = 0) {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 200, clientY: 100 });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: 200 + dx, clientY: 100 + dy });
}

describe('useSwipeSkip', () => {
  it('skips either way on a swipe', () => {
    const onNext = vi.fn();
    const onPrev = vi.fn();
    render(<Cover enabled onNext={onNext} onPrev={onPrev} onOpen={vi.fn()} />);
    drag(screen.getByTestId('cover'), -80);
    expect(onNext).toHaveBeenCalledTimes(1);
    drag(screen.getByTestId('cover'), 80);
    expect(onPrev).toHaveBeenCalledTimes(1);
    drag(screen.getByTestId('cover'), 10, 0);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it('a swipe that ends on the song link does not open it; a tap still does', () => {
    const onOpen = vi.fn();
    const onNext = vi.fn();
    render(<Cover enabled onNext={onNext} onPrev={vi.fn()} onOpen={onOpen} />);
    const link = screen.getByText('Song');
    drag(link, -80);
    fireEvent.click(link);
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the car controls are off', () => {
    const onNext = vi.fn();
    render(<Cover enabled={false} onNext={onNext} onPrev={vi.fn()} onOpen={vi.fn()} />);
    drag(screen.getByTestId('cover'), -80);
    expect(onNext).not.toHaveBeenCalled();
    expect(screen.getByTestId('cover').style.touchAction).toBe('');
  });
});
