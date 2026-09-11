import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { VolumeControl } from './VolumeControl';

// Same stub as SeekBar's: a range input standing in for base-ui's slider,
// which needs pointer capture happy-dom does not have. The volume slider
// commits on every change, so only onValueChange is wired.
vi.mock('@/components/ui/slider', () => ({
  Slider: ({
    value,
    max,
    disabled,
    onValueChange,
  }: {
    value: number[];
    max?: number;
    disabled?: boolean;
    onValueChange?: (v: number[]) => void;
  }) => (
    <input
      type="range"
      aria-label="volume"
      max={max}
      disabled={disabled}
      value={value[0]}
      onChange={(e) => onValueChange?.([Number(e.target.value)])}
    />
  ),
}));

function slider() {
  return screen.getByLabelText('volume') as HTMLInputElement;
}

describe('VolumeControl', () => {
  it('labels the button Mute while unmuted and Unmute while muted', () => {
    const onToggleMute = vi.fn();
    const { rerender } = render(
      <VolumeControl volume={0.5} muted={false} onChange={vi.fn()} onToggleMute={onToggleMute} />,
    );
    const mute = screen.getByRole('button', { name: 'Mute' });
    expect(mute).toHaveAttribute('title', 'Mute (M)');
    fireEvent.click(mute);
    expect(onToggleMute).toHaveBeenCalledTimes(1);

    rerender(<VolumeControl volume={0.5} muted onChange={vi.fn()} onToggleMute={onToggleMute} />);
    expect(screen.getByRole('button', { name: 'Unmute' })).toHaveAttribute('title', 'Unmute (M)');
  });

  it('reports the new volume as a fraction', () => {
    const onChange = vi.fn();
    render(<VolumeControl volume={0.5} muted={false} onChange={onChange} onToggleMute={vi.fn()} />);
    expect(slider().value).toBe('50');

    fireEvent.change(slider(), { target: { value: '80' } });
    expect(onChange).toHaveBeenCalledWith(0.8);
  });

  it('disables the slider while muted', () => {
    const { rerender } = render(
      <VolumeControl volume={0.5} muted={false} onChange={vi.fn()} onToggleMute={vi.fn()} />,
    );
    expect(slider()).not.toBeDisabled();

    rerender(<VolumeControl volume={0.5} muted onChange={vi.fn()} onToggleMute={vi.fn()} />);
    expect(slider()).toBeDisabled();
    expect(slider().parentElement).toHaveClass('opacity-40', 'pointer-events-none');
  });

  it('caps the slider at max, in percent of the fraction given', () => {
    render(
      <VolumeControl volume={0.5} muted={false} max={0.85} onChange={vi.fn()} onToggleMute={vi.fn()} />,
    );
    expect(slider()).toHaveAttribute('max', '85');
  });
});
