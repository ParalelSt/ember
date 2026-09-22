import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { PlainWordsSection } from '@/components/library/options/plainwords/PlainWordsSection';
import { PLAINWORDS_CANDIDATES } from '@/components/library/options/plainwords';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe('PlainWordsSection', () => {
  it('renders every candidate with a desktop and a phone frame, each with its own dialog', () => {
    render(<PlainWordsSection service="spotify" state="asking" />);
    const candidates = screen.getAllByTestId('plainwords-candidate');
    expect(candidates.map((c) => c.dataset.candidate)).toEqual(PLAINWORDS_CANDIDATES.map((o) => o.id));
    for (const c of candidates) {
      const dialogs = within(c).getAllByTestId('plainwords-dialog');
      expect(dialogs).toHaveLength(2);
      expect(dialogs.every((d) => d.dataset.service === 'spotify')).toBe(true);
    }
  });

  it('shows the steps for the picked service, only one service worth', () => {
    render(<PlainWordsSection service="apple" state="steps" />);
    for (const d of screen.getAllByTestId('plainwords-dialog')) {
      expect(d.dataset.service).toBe('apple');
      // Apple Music has one real route: every candidate goes straight to
      // its steps, no choice screen.
      expect(within(d).queryByTestId('plainwords-choice')).toBeNull();
      expect(within(d).getByTestId('plainwords-steps')).toBeInTheDocument();
    }
  });

  it('the YouTube Music exact route is an honest dead end on a phone', () => {
    render(<PlainWordsSection service="ytmusic" state="steps" />);
    const candidate = screen.getAllByTestId('plainwords-candidate').find((c) => c.dataset.candidate === 'what-you-have')!;
    const dialogs = within(candidate).getAllByTestId('plainwords-dialog');
    const phoneDialog = dialogs.find((d) => d.closest('[data-phone="true"]'))!;
    // Pick the desktop-only "what do you have" option inside the phone
    // frame's dialog.
    fireEvent.click(within(phoneDialog).getByText(/technical step/i));
    expect(within(phoneDialog).getByTestId('plainwords-dead-end')).toBeInTheDocument();
  });
});
