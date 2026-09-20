import { describe, expect, it } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { useIsDesktop } from './useIsDesktop';

function Probe() {
  return <span data-testid="probe">{useIsDesktop() ? 'desktop' : 'phone'}</span>;
}

/** happy-dom drives matchMedia off window.innerWidth, so the breakpoint can
 *  be checked for real rather than by mocking the hook away. 768px is
 *  Tailwind's `md`, the size the whole shell already splits on: below it
 *  search is the full-screen sheet, at it and above it is the dropdown. */
interface HappyWindow extends Omit<Window, 'innerWidth'> {
  innerWidth: number;
  happyDOM?: { setViewport?: (viewport: { width: number }) => void };
}

function setWidth(px: number) {
  act(() => {
    const w = window as unknown as HappyWindow;
    w.happyDOM?.setViewport?.({ width: px });
    w.innerWidth = px;
    w.dispatchEvent(new Event('resize'));
  });
}

describe('useIsDesktop', () => {
  it('is true at the md breakpoint and false below it', () => {
    setWidth(1280);
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('desktop');

    setWidth(767);
    expect(screen.getByTestId('probe')).toHaveTextContent('phone');

    setWidth(768);
    expect(screen.getByTestId('probe')).toHaveTextContent('desktop');
  });
});
