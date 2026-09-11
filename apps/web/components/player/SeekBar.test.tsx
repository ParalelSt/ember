import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { SeekBar } from './SeekBar';

// The real slider is base-ui's, which needs pointer capture and layout
// measurement happy-dom does not provide. This stub is a range input that
// exposes the same two callbacks: `change` on it stands for a drag (base-ui
// calls onValueChange with an array when the value prop is an array), and
// `mouseUp` stands for the release that commits.
vi.mock('@/components/ui/slider', () => ({
  Slider: ({
    value,
    onValueChange,
    onValueCommitted,
    className,
  }: {
    value: number[];
    onValueChange?: (v: number[]) => void;
    onValueCommitted?: (v: number[]) => void;
    className?: string;
  }) => (
    <input
      type="range"
      aria-label="progress"
      className={className}
      value={value[0]}
      onChange={(e) => onValueChange?.([Number(e.target.value)])}
      onMouseUp={(e) => onValueCommitted?.([Number(e.currentTarget.value)])}
    />
  ),
}));

function slider() {
  return screen.getByLabelText('progress') as HTMLInputElement;
}

describe('SeekBar', () => {
  it('shows the playback position until a drag starts', () => {
    render(<SeekBar position={30} duration={120} onSeek={vi.fn()} labels="inline" />);
    expect(slider().value).toBe('25');
    expect(screen.getByText('0:30')).toBeInTheDocument();
    expect(screen.getByText('2:00')).toBeInTheDocument();
  });

  it('follows the drag without seeking, then seeks once on release', () => {
    const onSeek = vi.fn();
    render(<SeekBar position={30} duration={120} onSeek={onSeek} labels="inline" />);

    fireEvent.change(slider(), { target: { value: '75' } });
    // The thumb has moved, but the audio has not: no seek until release.
    expect(slider().value).toBe('75');
    expect(screen.getByText('1:30')).toBeInTheDocument();
    expect(onSeek).not.toHaveBeenCalled();

    fireEvent.mouseUp(slider());
    expect(onSeek).toHaveBeenCalledTimes(1);
    expect(onSeek).toHaveBeenCalledWith(90);
  });

  it('goes back to the playback position after the release', () => {
    const { rerender } = render(<SeekBar position={30} duration={120} onSeek={vi.fn()} labels="inline" />);
    fireEvent.change(slider(), { target: { value: '75' } });
    fireEvent.mouseUp(slider());
    // The player answers the seek with a new position on the next render.
    rerender(<SeekBar position={90} duration={120} onSeek={vi.fn()} labels="inline" />);
    expect(slider().value).toBe('75');
    expect(screen.getByText('1:30')).toBeInTheDocument();
  });

  it('sits at zero without a duration', () => {
    const onSeek = vi.fn();
    render(<SeekBar position={12} duration={0} onSeek={onSeek} labels="below" />);
    expect(slider().value).toBe('0');
    fireEvent.change(slider(), { target: { value: '40' } });
    fireEvent.mouseUp(slider());
    expect(onSeek).toHaveBeenCalledWith(0);
  });

  it('renders both times below the slider for labels="below"', () => {
    const { container } = render(<SeekBar position={30} duration={120} onSeek={vi.fn()} labels="below" />);
    const times = container.querySelectorAll('span');
    expect([...times].map((s) => s.textContent)).toEqual(['0:30', '2:00']);
  });

  it('renders no labels by default and keeps the wrapper class', () => {
    const { container } = render(
      <SeekBar position={30} duration={120} onSeek={vi.fn()} className="md:hidden px-3 -mt-1" />,
    );
    expect(container.querySelectorAll('span')).toHaveLength(0);
    expect(container.firstElementChild).toHaveClass('md:hidden', 'px-3', '-mt-1');
  });
});
