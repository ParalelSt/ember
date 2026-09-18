import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { useSearchShortcut } from './useSearchShortcut';

function Harness({ onOpen }: { onOpen: () => void }) {
  useSearchShortcut(onOpen);
  return (
    <div>
      <input placeholder="typing target" />
    </div>
  );
}

describe('useSearchShortcut', () => {
  it('opens on "/" when focus is not in an input', () => {
    const onOpen = vi.fn();
    render(<Harness onOpen={onOpen} />);

    fireEvent.keyDown(document.body, { key: '/' });

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('ignores "/" while typing in an input, same guard the player shortcuts use', () => {
    const onOpen = vi.fn();
    const { getByPlaceholderText } = render(<Harness onOpen={onOpen} />);

    fireEvent.keyDown(getByPlaceholderText('typing target'), { key: '/' });

    expect(onOpen).not.toHaveBeenCalled();
  });
});
