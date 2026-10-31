import type { ComponentProps } from 'react';

/** Stand-in for `@/components/ui/slider` in unit tests (the real one is
 *  base-ui's Slider, which needs pointer capture and reads its state through
 *  a CommonJS shim that lands on the repo root's React 18, see
 *  popoverMock.tsx). A plain range input with the same props, marked
 *  data-slot="slider" so a test can tell the shared slider is in use.
 *
 *    vi.mock('@/components/ui/slider', () => import('@/test-utils/sliderMock')); */
type Props = Omit<ComponentProps<'input'>, 'value' | 'onChange'> & {
  value: number[];
  onValueChange?: (v: number[]) => void;
  thumbLabel?: string;
  getAriaValueText?: (formattedValue: string, value: number, index: number) => string;
};

export function Slider({ value, onValueChange, thumbLabel, getAriaValueText, ...rest }: Props) {
  return (
    <input
      {...rest}
      type="range"
      data-slot="slider"
      aria-label={thumbLabel}
      aria-valuetext={getAriaValueText?.(String(value[0]), value[0], 0)}
      value={value[0]}
      onChange={(e) => onValueChange?.([Number(e.target.value)])}
    />
  );
}
