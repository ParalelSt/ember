import { createRef } from 'react';
import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { BackToTop } from './BackToTop';

function setup() {
  const ref = createRef<HTMLDivElement>();
  render(
    <div className="relative">
      <div ref={ref} data-testid="scroller" />
      <BackToTop scrollRef={ref} />
    </div>,
  );
  return { scroller: screen.getByTestId('scroller'), button: screen.getByRole('button', { name: 'Back to top' }) };
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

describe('BackToTop', () => {
  it('shows only after the scroller has moved past 400px', async () => {
    const { scroller, button } = setup();
    expect(button.className).toContain('pointer-events-none');
    await act(async () => {
      scroller.scrollTop = 600;
      scroller.dispatchEvent(new Event('scroll'));
      await nextFrame();
    });
    expect(button.className).toContain('opacity-100');
  });

  // Bughunt V12: pinned to the scroller's column (its `relative` parent),
  // not the window, so it keeps the same small lift above the scroller's
  // edge with or without the player bar; the page's pb-section room is
  // what keeps the last row clear of it.
  it('is placed against its parent, a small step above the bottom', () => {
    const { button } = setup();
    expect(button.className).toContain('absolute');
    expect(button.className).not.toContain('fixed');
    expect(button.className).toContain('bottom-cluster');
    expect(button.className).toContain('md:bottom-block');
  });
});
