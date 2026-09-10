import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TransportControls } from './TransportControls';

function setup(props: Partial<Parameters<typeof TransportControls>[0]> = {}) {
  const onToggle = vi.fn();
  const onNext = vi.fn();
  const onPrev = vi.fn();
  const view = render(
    <TransportControls
      playing={false}
      onToggle={onToggle}
      onNext={onNext}
      onPrev={onPrev}
      size="sm"
      {...props}
    />,
  );
  return { ...view, onToggle, onNext, onPrev };
}

describe('TransportControls', () => {
  it('labels the middle button Play while paused and Pause while playing', () => {
    const { rerender, onToggle } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <TransportControls playing onToggle={onToggle} onNext={vi.fn()} onPrev={vi.fn()} size="sm" />,
    );
    expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull();
  });

  it('fires next and previous', () => {
    const { onNext, onPrev } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
  });

  it('renders the slots either side of the three buttons', () => {
    const { container } = setup({
      left: <button type="button">Shuffle</button>,
      right: <button type="button">Loop off</button>,
    });
    const labels = [...container.querySelectorAll('button')].map(
      (b) => b.getAttribute('aria-label') ?? b.textContent,
    );
    expect(labels).toEqual(['Shuffle', 'Previous', 'Play', 'Next', 'Loop off']);
  });

  it('renders nothing extra without slots', () => {
    const { container } = setup();
    expect(container.querySelectorAll('button')).toHaveLength(3);
  });

  it('sizes the buttons per size, keeping each bar geometry', () => {
    const { container, rerender } = setup();
    expect(container.firstElementChild).toHaveClass('flex', 'items-center', 'gap-3');
    expect(screen.getByRole('button', { name: 'Play' })).toHaveClass('h-10', 'w-10');

    rerender(
      <TransportControls
        playing={false}
        onToggle={vi.fn()}
        onNext={vi.fn()}
        onPrev={vi.fn()}
        size="lg"
        className="mt-6"
      />,
    );
    expect(container.firstElementChild).toHaveClass('relative', 'justify-center', 'gap-10', 'mt-6');
    expect(screen.getByRole('button', { name: 'Play' })).toHaveClass('h-16', 'w-16');
    expect(screen.getByRole('button', { name: 'Previous' })).toHaveClass('h-12', 'w-12');
  });
});
