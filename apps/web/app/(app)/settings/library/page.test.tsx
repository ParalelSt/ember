import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SettingsLibrary from './page';

// The Transfer entry point: a row in Settings > Library that opens the
// transfer dialog. The dialog itself is covered by its own test.

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...rest }: ComponentProps<'button'>) => <button {...rest}>{children}</button>,
}));
vi.mock('@/components/import/TransferDialog', () => ({
  TransferDialog: ({ open, from }: { open: boolean; from?: string }) =>
    open ? <div data-testid="transfer-dialog" data-from={from} /> : null,
}));

describe('Settings > Library', () => {
  it('has a Transfer from another app row explaining what it does', () => {
    render(<SettingsLibrary />);
    expect(screen.getByText('Transfer from another app')).toBeInTheDocument();
    expect(screen.getByText(/become your likes, or a new playlist/)).toBeInTheDocument();
    expect(screen.queryByTestId('transfer-dialog')).toBeNull();
  });

  it('the row opens the transfer dialog, tagged where it came from', () => {
    render(<SettingsLibrary />);
    fireEvent.click(screen.getByTestId('settings-transfer-button'));
    expect(screen.getByTestId('transfer-dialog')).toHaveAttribute('data-from', 'settings');
  });
});
