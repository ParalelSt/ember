import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import DizajnPage from './page';
import { COPY_OPTIONS, COPY_RECOMMENDED, COPY_STEPS } from '@/components/library/options/playlist-copy';

// next/link reads the app router context, which no test renders (see
// components/OnlineOnly.test.tsx); ShellPreview's nav bits all use it too.
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

describe('DizajnPage (playlist copy)', () => {
  it('shows every candidate and step, named, and links to the full gallery', () => {
    render(<DizajnPage />);
    const candidates = screen.getByRole('radiogroup', { name: 'Candidate' });
    for (const o of COPY_OPTIONS) {
      expect(within(candidates).getByRole('radio', { name: new RegExp(o.name) })).toBeInTheDocument();
    }
    const steps = screen.getByRole('radiogroup', { name: 'Step' });
    for (const s of COPY_STEPS) {
      expect(within(steps).getByRole('radio', { name: s.name })).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: 'the full gallery' })).toHaveAttribute('href', '/dizajn/sve');
  });

  it('marks exactly one candidate Recommended, with a one-line reason', () => {
    render(<DizajnPage />);
    const candidates = screen.getByRole('radiogroup', { name: 'Candidate' });
    expect(within(candidates).getAllByText('Recommended')).toHaveLength(1);
    const name = COPY_OPTIONS.find((o) => o.id === COPY_RECOMMENDED)!.name;
    expect(within(within(candidates).getByRole('radio', { name: new RegExp(name) })).getByText('Recommended')).toBeInTheDocument();
    expect(screen.getByTestId('copy-recommended').textContent).toMatch(new RegExp(`Recommended: ${name}\\.`));
  });

  it('opens on the recommended candidate, and the pickers switch the frames', () => {
    render(<DizajnPage />);
    const section = () => screen.getByTestId('playlist-copy-section');
    expect(section()).toHaveAttribute('data-option', COPY_RECOMMENDED);
    expect(section()).toHaveAttribute('data-step', 'select');

    for (const o of COPY_OPTIONS) {
      fireEvent.click(screen.getByRole('radio', { name: new RegExp(o.name) }));
      expect(section()).toHaveAttribute('data-option', o.id);
      expect(screen.getAllByTestId(`copy-candidate-${o.id}`)).toHaveLength(2);
    }
    for (const s of COPY_STEPS) {
      fireEvent.click(screen.getByRole('radio', { name: s.name }));
      expect(section()).toHaveAttribute('data-step', s.id);
    }
    fireEvent.click(screen.getByRole('radio', { name: 'Liked songs warning' }));
    expect(screen.getAllByTestId('copy-liked-confirm')).toHaveLength(2);
  });
});
