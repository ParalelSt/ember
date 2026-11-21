import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import SettingsLibrary from './page';

// next/link reads the app router context, which no test renders.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

// The Transfer entry point in Settings > Library: a row that opens the same
// Transfer page the Liked songs page opens. The page itself is covered by
// components/import/TransferFlow.test.tsx.

describe('Settings > Library', () => {
  it('has a Transfer from another app row explaining what it does', () => {
    render(<SettingsLibrary />);
    expect(screen.getByText('Transfer from another app')).toBeInTheDocument();
    expect(screen.getByText(/become your likes, or a new playlist/)).toBeInTheDocument();
  });

  it('the row opens the Transfer page, and Back returns here', () => {
    render(<SettingsLibrary />);
    const link = screen.getByTestId('settings-transfer-button');
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', `/transfer?from=${encodeURIComponent('/settings/library')}`);
  });
});
