import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DizajnPage from './page';
import { TOPBAR_OPTIONS } from '@/components/library/options/topbar';

// next/link reads the app router context, which no test renders (see
// components/OnlineOnly.test.tsx).
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

describe('DizajnPage', () => {
  it('shows the desktop top bar candidates and links to the full gallery', () => {
    render(<DizajnPage />);
    expect(screen.getByRole('heading', { name: 'Desktop top bar' })).toBeInTheDocument();
    const sections = screen.getAllByTestId('topbar-section');
    expect(sections.map((s) => s.getAttribute('data-candidate'))).toEqual(TOPBAR_OPTIONS.map((c) => c.id));
    expect(screen.getAllByTestId('topbar-recommended-badge')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'the full gallery' })).toHaveAttribute('href', '/dizajn/sve');
  });
});
