import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DizajnPage from './page';
import { SEARCHGAP_OPTIONS, SEARCHGAP_RECOMMENDED } from '@/components/library/options/searchgap';

// next/link reads the app router context, which no test renders (see
// components/OnlineOnly.test.tsx).
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

describe('DizajnPage', () => {
  it('has the search-bar-gap question open and links to the full gallery', () => {
    render(<DizajnPage />);
    expect(screen.getByRole('heading', { name: 'Search bar bottom gap' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'the full gallery' })).toHaveAttribute('href', '/dizajn/sve');
  });

  it('renders every search-gap candidate section once, at both desktop widths', () => {
    render(<DizajnPage />);
    const sections = screen.getAllByTestId('searchgap-section');
    expect(sections).toHaveLength(SEARCHGAP_OPTIONS.length);
    for (const candidate of SEARCHGAP_OPTIONS) {
      const section = sections.find((s) => s.getAttribute('data-candidate') === candidate.id)!;
      expect(section).toBeTruthy();
      const frames = section.querySelectorAll('[data-testid="searchgap-frame"]');
      expect(frames).toHaveLength(2);
      for (const frame of frames) {
        expect(frame).toHaveAttribute('data-gap-px', String(candidate.gapPx));
      }
    }
  });

  it('has exactly one Recommended candidate', () => {
    render(<DizajnPage />);
    expect(screen.getAllByTestId('searchgap-recommended-badge')).toHaveLength(1);
    expect(SEARCHGAP_OPTIONS.filter((o) => o.id === SEARCHGAP_RECOMMENDED)).toHaveLength(1);
  });
});
