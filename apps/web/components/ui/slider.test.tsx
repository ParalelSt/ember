import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
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
    Control: ({ children }: PropsWithChildren) => <div>{children}</div>,
    Track: ({ children }: PropsWithChildren) => <div>{children}</div>,
    Indicator: () => <div />,
    Thumb: (props: Record<string, unknown>) => {
      thumbProps.current = props;
      return <div />;
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
