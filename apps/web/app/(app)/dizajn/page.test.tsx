import type { ComponentProps, PropsWithChildren } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import DizajnPage from './page';
import {
  TRANSFER_DESTINATION_OPTIONS,
  TRANSFER_ENTRY_OPTIONS,
  TRANSFER_ENTRY_RECOMMENDED,
  TRANSFER_STATES,
} from '@/components/library/options/transfer';

// next/link reads the app router context, which no test renders (see
// components/OnlineOnly.test.tsx); ShellPreview's nav bits all use it too.
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

describe('DizajnPage (transfer)', () => {
  it('shows every entry-point and destination candidate, named, and links to the full gallery', () => {
    render(<DizajnPage />);
    const entries = screen.getAllByTestId('transfer-entry-candidate');
    expect(entries.map((c) => c.dataset.entry)).toEqual(TRANSFER_ENTRY_OPTIONS.map((o) => o.id));
    const destinations = screen.getAllByTestId('transfer-destination-candidate');
    expect(destinations.map((c) => c.dataset.destination)).toEqual(TRANSFER_DESTINATION_OPTIONS.map((o) => o.id));
    for (const o of [...TRANSFER_ENTRY_OPTIONS, ...TRANSFER_DESTINATION_OPTIONS]) {
      expect(screen.getAllByText(o.name).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole('link', { name: 'the full gallery' })).toHaveAttribute('href', '/dizajn/sve');
  });

  it('marks exactly one option as Recommended, the entry point', () => {
    render(<DizajnPage />);
    const tagged = screen.getAllByText('Recommended').map((t) => t.closest('[data-testid="transfer-entry-candidate"]'));
    expect(tagged).toHaveLength(1);
    expect((tagged[0] as HTMLElement).dataset.entry).toBe(TRANSFER_ENTRY_RECOMMENDED);
  });

  it('the state picker switches every Liked-page frame: idle shows no banner, running shows progress, done shows the summary', () => {
    render(<DizajnPage />);
    expect(screen.getAllByRole('radio', { name: TRANSFER_STATES.find((s) => s.id === 'idle')!.name })).toHaveLength(1);

    const liked = () => screen.getByTestId('transfer-liked-states');
    expect(within(liked()).queryByTestId('import-progress-banner')).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: 'Running' }));
    expect(within(liked()).getAllByTestId('import-progress-banner').length).toBeGreaterThan(0);
    expect(within(liked()).getAllByTestId('transferring-block').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('radio', { name: 'Done, some missing' }));
    expect(within(liked()).getAllByTestId('import-summary').length).toBeGreaterThan(0);
    expect(within(liked()).queryByTestId('import-progress-banner')).toBeNull();
  });
});
