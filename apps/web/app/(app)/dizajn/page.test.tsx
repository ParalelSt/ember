import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import DizajnPage from './page';
import {
  PLAINWORDS_CANDIDATES,
  PLAINWORDS_RECOMMENDED,
  PLAINWORDS_SERVICE_OPTIONS,
  PLAINWORDS_STATES,
} from '@/components/library/options/plainwords';

// next/link reads the app router context, which no test renders (see
// components/OnlineOnly.test.tsx); ShellPreview's nav bits all use it too.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const candidates = () => screen.getAllByTestId('plainwords-candidate');

describe('DizajnPage (plain-words Transfer)', () => {
  it('shows every candidate, named, and links to the full gallery', () => {
    render(<DizajnPage />);
    expect(candidates().map((c) => c.dataset.candidate)).toEqual(PLAINWORDS_CANDIDATES.map((o) => o.id));
    for (const o of PLAINWORDS_CANDIDATES) {
      expect(screen.getAllByText(o.name).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole('link', { name: 'the full gallery' })).toHaveAttribute('href', '/dizajn/sve');
  });

  it('marks exactly one candidate as Recommended', () => {
    render(<DizajnPage />);
    const tagged = screen.getAllByText('Recommended').map((t) => t.closest('[data-testid="plainwords-candidate"]'));
    expect(tagged).toHaveLength(1);
    expect((tagged[0] as HTMLElement).dataset.candidate).toBe(PLAINWORDS_RECOMMENDED);
  });

  it('starts on the asking screen: every dialog shows the four service cards', () => {
    render(<DizajnPage />);
    for (const c of candidates()) {
      const dialogs = within(c).getAllByTestId('plainwords-dialog');
      for (const d of dialogs) {
        expect(d.dataset.state).toBe('asking');
        expect(within(d).getAllByTestId('plainwords-service-card')).toHaveLength(PLAINWORDS_SERVICE_OPTIONS.length);
      }
    }
  });

  it('the service picker switches every candidate frame to that service', () => {
    render(<DizajnPage />);
    fireEvent.click(screen.getByRole('radio', { name: 'YouTube Music' }));
    for (const c of candidates()) {
      for (const d of within(c).getAllByTestId('plainwords-dialog')) {
        expect(d.dataset.service).toBe('ytmusic');
      }
    }
  });

  it('the state picker switches every candidate frame between asking, steps and a result', () => {
    render(<DizajnPage />);
    for (const s of PLAINWORDS_STATES) {
      fireEvent.click(screen.getByRole('radio', { name: s.name }));
      for (const c of candidates()) {
        for (const d of within(c).getAllByTestId('plainwords-dialog')) {
          expect(d.dataset.state).toBe(s.id);
        }
      }
    }
    // Landing straight on "Result" (no click-through) still has to show
    // something: every candidate falls back to its first route.
    for (const c of candidates()) {
      expect(
        within(c).queryAllByTestId('plainwords-result').length + within(c).queryAllByTestId('plainwords-dead-end').length,
      ).toBeGreaterThan(0);
    }
  });
});
