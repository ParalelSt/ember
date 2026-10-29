import type { PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ open, children }: PropsWithChildren<{ open: boolean }>) => (open ? <div>{children}</div> : null),
  SheetContent: ({ children, ...rest }: PropsWithChildren) => <div role="dialog" {...rest}>{children}</div>,
  SheetHeader: ({ children }: PropsWithChildren) => <div>{children}</div>,
  SheetTitle: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
}));
vi.mock('@/components/settings/EqualizerPanel', () => ({ EqualizerPanel: () => <div data-testid="eq-panel" /> }));

const { EqualizerSheet } = await import('./EqualizerSheet');

describe('EqualizerSheet', () => {
  it('is called Equalizer, the same as the row that opens it (popups1)', () => {
    render(<EqualizerSheet open onOpenChange={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Equalizer' })).toBeInTheDocument();
    expect(screen.getByTestId('eq-panel')).toBeInTheDocument();
  });

  it('is one of the player\'s own sheets: the player\'s keyboard shortcuts keep working over it', () => {
    render(<EqualizerSheet open onOpenChange={() => {}} />);
    expect(screen.getByRole('dialog')).toHaveAttribute('data-player-view');
  });
});
