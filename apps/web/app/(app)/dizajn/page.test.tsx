import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import DizajnPage from './page';
import { ATTACH_RECOMMENDED, ATTACH_STYLES } from '@/components/library/options/attachments';

// next/link reads the app router context, which no test renders (see
// components/OnlineOnly.test.tsx).
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const styles = () => screen.getAllByTestId('attach-style');

describe('DizajnPage (attachments)', () => {
  it('shows every attach style, each in both forms, and links to the full gallery', () => {
    render(<DizajnPage />);
    expect(styles().map((s) => s.dataset.style)).toEqual(ATTACH_STYLES.map((s) => s.id));
    for (const s of styles()) {
      const dialogs = within(s).getAllByTestId('attach-dialog');
      expect(dialogs.map((d) => within(d).getByText(/Send a request|Report a bug/).textContent)).toEqual([
        'Send a request',
        'Report a bug',
      ]);
    }
    expect(screen.getByRole('link', { name: 'the full gallery' })).toHaveAttribute('href', '/dizajn/sve');
  });

  it('opens on two files: a thumbnail each and a running total, Send enabled', () => {
    render(<DizajnPage />);
    for (const s of styles()) {
      for (const d of within(s).getAllByTestId('attach-dialog')) {
        expect(within(d).getAllByTestId('attach-thumb')).toHaveLength(2);
        expect(within(d).getByText(/2 of 4 files, 7\.6 MB of 10 MB/)).toBeInTheDocument();
        expect(within(d).getByRole('button', { name: /^Send/ })).toBeEnabled();
        expect(within(d).getByRole('button', { name: 'Remove queue-jumps.png' })).toBeInTheDocument();
      }
    }
  });

  it('too big: every form says so and Send is disabled', () => {
    render(<DizajnPage />);
    fireEvent.click(screen.getByRole('radio', { name: 'Too big' }));
    for (const d of screen.getAllByTestId('attach-dialog')) {
      expect(within(d).getByTestId('attach-problem')).toHaveTextContent(
        'Files are 39.6 MB. Discord takes 10 MB per message: trim the clip or send fewer files.',
      );
      expect(within(d).getByRole('button', { name: /^Send/ })).toBeDisabled();
    }
  });

  it('nothing attached: only the footer style hides everything but its paperclip', () => {
    render(<DizajnPage />);
    fireEvent.click(screen.getByRole('radio', { name: 'Nothing attached' }));
    expect(screen.queryAllByTestId('attach-thumb')).toHaveLength(0);
    const byStyle = Object.fromEntries(styles().map((s) => [s.dataset.style, s]));
    expect(within(byStyle.chips).getAllByRole('button', { name: 'Attach screenshot or video' })).toHaveLength(2);
    expect(within(byStyle.footer).getAllByRole('button', { name: 'Attach screenshot or video' })).toHaveLength(2);
    expect(within(byStyle.dropzone).getAllByText(/Drop screenshots or a clip here/)).toHaveLength(2);
    expect(within(byStyle.footer).queryByText(/of 4 files/)).toBeNull();
  });

  it('marks exactly one style as recommended', () => {
    render(<DizajnPage />);
    const tagged = screen.getAllByText('Recommended').map((t) => t.closest('[data-testid="attach-style"]'));
    expect(tagged).toHaveLength(1);
    expect((tagged[0] as HTMLElement).dataset.style).toBe(ATTACH_RECOMMENDED);
  });
});
