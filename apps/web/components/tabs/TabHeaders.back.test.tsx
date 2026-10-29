import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { StageHeader } from './TabStage';
import { TabSheetHeader } from './TabSheetHeader';

// Both tab headers use the app's one back button (components/ui/back-button).
describe('tab headers back', () => {
  it('the stage header back is the shared BackButton', () => {
    const onBack = vi.fn();
    render(<StageHeader title="Song" meta="Artist" dim={false} onBack={onBack} />);
    const back = screen.getByRole('button', { name: 'Back' });
    expect(back).toHaveAttribute('data-slot', 'back-button');
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('the sheet header back is the shared BackButton, and absent with no onBack', () => {
    const onBack = vi.fn();
    const { unmount } = render(<TabSheetHeader phone={false} title="Song" meta="Artist" onBack={onBack} />);
    const back = screen.getByRole('button', { name: 'Back' });
    expect(back).toHaveAttribute('data-slot', 'back-button');
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
    unmount();
    render(<TabSheetHeader phone={false} title="Song" meta="Artist" />);
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });
});
