import type { ComponentProps, PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import {
  TRANSFER_DESTINATION_OPTIONS,
  TRANSFER_ENTRY_OPTIONS,
  TRANSFER_ENTRY_RECOMMENDED,
} from '@/components/library/options/transfer';

// next/link reads the app router context, which no test renders (see
// components/OnlineOnly.test.tsx); ShellPreview's nav bits all use it.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
// base-ui's dialog resolves a second React copy under happy-dom (see
// components/import/ReviewSheet.test.tsx): the Done state opens the real
// review sheet, so render its parts as plain elements.
vi.mock('@base-ui/react/dialog', () => {
  const Pass = ({ children }: PropsWithChildren) => <>{children}</>;
  return {
    Dialog: {
      Root: ({ open, children }: PropsWithChildren<{ open: boolean }>) => (open ? <>{children}</> : null),
      Portal: Pass,
      Backdrop: () => null,
      Popup: ({ children, ...rest }: ComponentProps<'div'>) => (
        <div role="dialog" {...rest}>
          {children}
        </div>
      ),
      Title: ({ children }: PropsWithChildren) => <h2>{children}</h2>,
      Close: ({ children }: PropsWithChildren) => (
        <button type="button" aria-label="Close">
          {children}
        </button>
      ),
    },
  };
});

const { TransferSection } = await import('./TransferSection');

describe('TransferSection', () => {
  it('renders every entry-point candidate, named, with exactly one Recommended', () => {
    render(<TransferSection state="idle" />);
    const cards = screen.getAllByTestId('transfer-entry-candidate');
    expect(cards.map((c) => c.dataset.entry)).toEqual(TRANSFER_ENTRY_OPTIONS.map((o) => o.id));
    for (const o of TRANSFER_ENTRY_OPTIONS) {
      expect(screen.getAllByText(o.name).length).toBeGreaterThan(0);
    }
    const recommended = screen.getAllByText('Recommended');
    expect(recommended).toHaveLength(1);
    expect(recommended[0].closest('[data-testid="transfer-entry-candidate"]')).toHaveAttribute(
      'data-entry',
      TRANSFER_ENTRY_RECOMMENDED,
    );
  });

  it('renders every destination candidate, named, with its own dialog control', () => {
    render(<TransferSection state="idle" />);
    const cards = screen.getAllByTestId('transfer-destination-candidate');
    expect(cards.map((c) => c.dataset.destination)).toEqual(TRANSFER_DESTINATION_OPTIONS.map((o) => o.id));
    for (const o of TRANSFER_DESTINATION_OPTIONS) {
      expect(screen.getAllByText(o.name).length).toBeGreaterThan(0);
    }
    // Every dialog on the page shows the shared source tabs (link, file, paste).
    for (const d of screen.getAllByTestId('transfer-dialog')) {
      expect(within(d).getByRole('tab', { name: 'Paste a link' })).toBeInTheDocument();
    }
  });

  it('the state picker switches the Liked page frames between idle, running and done', () => {
    const { rerender } = render(<TransferSection state="idle" />);
    let liked = screen.getByTestId('transfer-liked-states');
    expect(within(liked).queryByTestId('import-progress-banner')).toBeNull();
    expect(within(liked).queryByTestId('import-summary')).toBeNull();

    rerender(<TransferSection state="running" />);
    liked = screen.getByTestId('transfer-liked-states');
    expect(within(liked).getAllByTestId('import-progress-banner').length).toBeGreaterThan(0);
    expect(within(liked).getAllByTestId('transferring-block').length).toBeGreaterThan(0);

    rerender(<TransferSection state="done" />);
    liked = screen.getByTestId('transfer-liked-states');
    expect(within(liked).getAllByTestId('import-summary').length).toBeGreaterThan(0);
  });
});
