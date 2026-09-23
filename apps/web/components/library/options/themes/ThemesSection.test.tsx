import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemesSection } from '@/components/library/options/themes/ThemesSection';
import { THEME_LAYOUT_OPTIONS, THEME_STATES } from '@/components/library/options/themes';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: ComponentProps<'a'>) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

describe('ThemesSection', () => {
  it('renders every layout candidate, for every gallery state, with no crash', () => {
    for (const layout of THEME_LAYOUT_OPTIONS) {
      for (const state of THEME_STATES) {
        const { unmount } = render(<ThemesSection layout={layout.id} state={state.id} />);
        const section = screen.getByTestId('themes-section');
        expect(section).toHaveAttribute('data-layout', layout.id);
        expect(section).toHaveAttribute('data-state', state.id);
        expect(screen.getAllByTestId('live-theme-preview')).toHaveLength(2);
        expect(screen.getAllByTestId(`theme-layout-${layout.id}`)).toHaveLength(2);
        unmount();
      }
    }
  });

  it('shows the readability finding, with Fix it, only for the warning state', () => {
    render(<ThemesSection layout="inspector" state="warning" />);
    const findings = screen.getAllByTestId('readability-finding');
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(f.textContent).toContain('hard to read');
    }
  });

  it('does not show the readability finding on the preset state', () => {
    render(<ThemesSection layout="inspector" state="preset" />);
    expect(screen.queryByTestId('readability-finding')).toBeNull();
  });
});
