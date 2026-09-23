import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import DizajnPage from './page';
import { PRANK_OPTIONS, PRANK_RECOMMENDED, PRANK_STATES } from '@/components/library/options/pranks';

// next/link reads the app router context, which no test renders (see
// components/OnlineOnly.test.tsx); ShellPreview's nav bits all use it too.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

describe('DizajnPage (pranks)', () => {
  it('shows every candidate, named, and links to the full gallery', () => {
    render(<DizajnPage />);
    for (const o of PRANK_OPTIONS) {
      expect(screen.getByRole('radio', { name: new RegExp(o.name) })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'the full gallery' })).toHaveAttribute('href', '/dizajn/sve');
  });

  it('marks exactly one candidate as Recommended', () => {
    render(<DizajnPage />);
    expect(screen.getAllByText('Recommended')).toHaveLength(1);
    const recommendedName = PRANK_OPTIONS.find((o) => o.id === PRANK_RECOMMENDED)!.name;
    const btn = screen.getByRole('radio', { name: new RegExp(recommendedName) });
    expect(within(btn).getByText('Recommended')).toBeInTheDocument();
  });

  it('the candidate picker switches which design renders', () => {
    render(<DizajnPage />);
    const section = () => screen.getByTestId('pranks-section');
    expect(section()).toHaveAttribute('data-option', PRANK_OPTIONS[0].id);

    for (const o of PRANK_OPTIONS) {
      fireEvent.click(screen.getByRole('radio', { name: new RegExp(o.name) }));
      expect(section()).toHaveAttribute('data-option', o.id);
      expect(screen.getAllByTestId(`prank-candidate-${o.id}`).length).toBeGreaterThan(0);
    }
  });

  it('the state picker switches every frame at once', () => {
    render(<DizajnPage />);
    const section = () => screen.getByTestId('pranks-section');
    expect(section()).toHaveAttribute('data-state', 'idle');
    expect(screen.queryAllByTestId('prank-schedule-banner')).toHaveLength(0);

    for (const s of PRANK_STATES) {
      fireEvent.click(screen.getByRole('radio', { name: s.name }));
      expect(section()).toHaveAttribute('data-state', s.id);
    }

    fireEvent.click(screen.getByRole('radio', { name: 'Repeat running' }));
    expect(screen.getAllByTestId('prank-schedule-banner').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('radio', { name: 'Off switch on' }));
    expect(within(screen.getAllByTestId('prank-global-switch')[0]).getByRole('switch')).toHaveAttribute('aria-checked', 'false');
  });
});
