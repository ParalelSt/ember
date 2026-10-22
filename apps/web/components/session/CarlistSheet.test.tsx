import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: PropsWithChildren<{ open: boolean }>) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children, showCloseButton = true }: PropsWithChildren<{ showCloseButton?: boolean }>) => (
    <div role="dialog">
      {showCloseButton && <button type="button">Close</button>}
      {children}
    </div>
  ),
  DialogTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
  DialogDescription: ({ children }: PropsWithChildren) => <p>{children}</p>,
}));
vi.mock('@/lib/useBackDismiss', () => ({ useBackDismiss: () => {} }));

const { CarlistSheet } = await import('./CarlistSheet');

describe('CarlistSheet', () => {
  it('has a close button like every other dialog (popups1)', () => {
    render(<CarlistSheet open onOpenChange={() => {}} onStart={() => {}} onJoin={() => {}} />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start a carlist/ })).toBeInTheDocument();
  });
});
