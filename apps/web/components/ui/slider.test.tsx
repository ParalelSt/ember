import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';

// The real @base-ui/react Slider needs pointer capture and a matching
// React copy that happy-dom/vitest doesn't provide here (see
// components/player/SeekBar.test.tsx and QueueSheet.test.tsx for the same
// issue with Dialog). This stubs just enough of its shape to check that our
// wrapper (components/ui/slider.tsx) forwards thumbLabel/getAriaValueText
// to the Thumb the way base-ui expects: getAriaLabel/getAriaValueText
// functions, not raw strings.
const thumbProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock('@base-ui/react/slider', () => ({
  Slider: {
    Root: ({ children }: PropsWithChildren) => <div>{children}</div>,
    Control: ({ children, className }: PropsWithChildren<{ className?: string }>) => (
      <div data-testid="control" className={className}>{children}</div>
    ),
    Track: ({ children, className }: PropsWithChildren<{ className?: string }>) => (
      <div data-testid="track" className={className}>{children}</div>
    ),
    Indicator: ({ className }: { className?: string }) => <div data-testid="fill" className={className} />,
    Thumb: (props: Record<string, unknown>) => {
      thumbProps.current = props;
      return <div data-testid="thumb" className={props.className as string} />;
    },
  },
}));

import { Slider } from './slider';

describe('Slider (thumbLabel / getAriaValueText wiring)', () => {
  it('turns thumbLabel into a getAriaLabel function, for base-ui\'s Thumb', () => {
    render(<Slider value={[10]} thumbLabel="Seek" />);
    const getAriaLabel = thumbProps.current!.getAriaLabel as (() => string) | undefined;
    expect(getAriaLabel?.()).toBe('Seek');
  });

  it('omits getAriaLabel entirely when no thumbLabel is given', () => {
    render(<Slider value={[10]} />);
    expect(thumbProps.current!.getAriaLabel).toBeUndefined();
  });

  it('forwards getAriaValueText straight through to the Thumb', () => {
    const getAriaValueText = vi.fn((_formatted: string, value: number) => `${value}%`);
    render(<Slider value={[10]} getAriaValueText={getAriaValueText} />);
    expect(thumbProps.current!.getAriaValueText).toBe(getAriaValueText);
  });
});

describe('Slider (the "Thick" look)', () => {
  it('has an 8px track, an ember fill and an 18px thumb', () => {
    render(<Slider value={[10]} />);
    expect(screen.getByTestId('track').className).toContain('data-horizontal:h-2');
    expect(screen.getByTestId('fill').className).toContain('bg-ember');
    expect(screen.getByTestId('fill').className).not.toContain('bg-primary');
    expect(screen.getByTestId('thumb').className).toContain('size-4.5');
  });

  it('keeps the 28px box the player bars and the live spacer are sized on', () => {
    render(<Slider value={[10]} />);
    // 8px track + 10px padding above and below = 28px = SeekBar's h-7 spacer.
    expect(screen.getByTestId('control').className).toContain('data-horizontal:py-2.5');
  });

  it('keeps the disabled look and a hit area bigger than the thumb', () => {
    render(<Slider value={[10]} disabled />);
    expect(screen.getByTestId('control').className).toContain('data-disabled:opacity-50');
    expect(screen.getByTestId('thumb').className).toContain('after:-inset-2');
  });
});
